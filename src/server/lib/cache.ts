import { Redis } from '@upstash/redis'

import { hasEnv } from '@/src/server/config/env'
import { logger } from '@/src/server/lib/logger'

const redis = hasEnv('UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN')
  ? Redis.fromEnv()
  : null

const inflight = new Map<string, Promise<unknown>>()

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  if (!redis) {
    return fetcher()
  }

  try {
    const existing = await redis.get<T>(key)

    if (existing !== null) {
      return existing
    }
  } catch (error) {
    logger.warn('cache.read_failed', { key, error })
    return fetcher()
  }

  // Single-flight: when many requests miss at once (cold cache, expiry, or a
  // just-invalidated key), coalesce them onto one upstream fetch instead of
  // stampeding the database. A rejected fetch propagates to every waiter and
  // is never cached, so a backend outage cannot poison Redis with bad data.
  const pending = inflight.get(key)
  if (pending) {
    return pending as Promise<T>
  }

  const fresh = fetcher()
    .then((value) => {
      redis!.set(key, value, { ex: ttlSeconds }).catch((error) => {
        logger.warn('cache.write_failed', { key, error })
      })
      return value
    })
    .finally(() => {
      inflight.delete(key)
    })

  inflight.set(key, fresh)

  return fresh
}

export async function invalidateCache(key: string): Promise<void> {
  if (!redis) {
    return
  }

  try {
    await redis.del(key)
  } catch (error) {
    logger.warn('cache.invalidate_failed', { key, error })
  }
}

/**
 * Rate-limits repeat background warnings: claims a key for a window and reports
 * whether this call is the first (and therefore the one that should log). Used
 * to stop a throttled alert from becoming an alert storm on every page load.
 */
export async function claimThrottleMarker(key: string, ttlSeconds: number): Promise<boolean> {
  if (!redis) {
    return true
  }

  try {
    const claimed = await redis.set(key, '1', { ex: ttlSeconds, nx: true })
    return claimed === 'OK'
  } catch (error) {
    logger.warn('cache.throttle_marker_failed', { key, error })
    return true
  }
}

export async function pingCache(): Promise<'healthy' | 'degraded'> {
  if (!redis) {
    return 'degraded'
  }

  try {
    await redis.ping()
    return 'healthy'
  } catch (error) {
    logger.warn('cache.ping_failed', { error })
    return 'degraded'
  }
}
