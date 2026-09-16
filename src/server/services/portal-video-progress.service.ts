import { isSupabaseReady, supabaseAdmin } from '@/lib/server/supabase'
import { cached, invalidateCache } from '@/src/server/lib/cache'
import type { VideoProgressInput } from '@/src/server/api/validators/portal.validator'

export type PracticeProgressRow = {
  videoId: string
  progressPercent: number
  completed: boolean
  lastWatchedAt: string
  watchedSeconds: number
  practicedCount: number
  lastPracticedAt: string | null
}

export class PortalVideoProgressService {
  private static progressListKey(skfId: string) {
    return `portal:progress:${skfId}`
  }

  static async save(skfId: string, input: VideoProgressInput) {
    if (!isSupabaseReady()) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Database not configured for portal video progress.')
      }
      return { success: true, mock: true }
    }

    const row: Record<string, unknown> = {
      skf_id: skfId,
      video_id: input.videoId,
      watched_percent: input.progressPercent,
      completed: input.progressPercent >= 100,
      last_watched: new Date().toISOString(),
    }
    if (input.seconds !== undefined) {
      row.watched_seconds = input.seconds
    }

    const { error } = await supabaseAdmin.from('video_progress').upsert(row, { onConflict: 'skf_id,video_id' })

    if (error) {
      throw error
    }

    await invalidateCache(PortalVideoProgressService.progressListKey(skfId))
    return { success: true }
  }

  /**
   * Batch-save progress for multiple videos in a single round-trip.
   * Deduplicates by videoId (last entry wins) and filters out no-op updates
   * where the stored percent already matches.
   */
  static async saveBatch(skfId: string, entries: VideoProgressInput[]) {
    if (!isSupabaseReady()) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Database not configured for portal video progress.')
      }
      return { success: true, mock: true }
    }

    if (!entries.length) return { success: true, saved: 0 }

    const deduped = new Map<string, VideoProgressInput>()
    for (const entry of entries) {
      deduped.set(entry.videoId, entry)
    }

    const now = new Date().toISOString()
    const rows = [...deduped.values()].map((entry) => {
      const row: Record<string, unknown> = {
        skf_id: skfId,
        video_id: entry.videoId,
        watched_percent: entry.progressPercent,
        completed: entry.progressPercent >= 100,
        last_watched: now,
      }
      if (entry.seconds !== undefined) {
        row.watched_seconds = entry.seconds
      }
      return row
    })

    const { error } = await supabaseAdmin
      .from('video_progress')
      .upsert(rows, { onConflict: 'skf_id,video_id' })

    if (error) {
      throw error
    }

    await invalidateCache(PortalVideoProgressService.progressListKey(skfId))
    return { success: true, saved: rows.length }
  }

  /** Atomic "Practiced ✓" tap. Never counts mere watching as drilling. */
  static async recordPracticed(skfId: string, videoId: string) {
    if (!isSupabaseReady()) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Database not configured for portal video progress.')
      }
      return { success: true, mock: true }
    }

    const { data, error } = await supabaseAdmin.rpc('portal_bump_practice', {
      p_skf_id: skfId,
      p_video_id: videoId,
    })

    if (error) {
      throw error
    }

    await invalidateCache(PortalVideoProgressService.progressListKey(skfId))
    return { success: true, practicedCount: Number(data) || 0 }
  }

  static async list(skfId: string) {
    if (!isSupabaseReady()) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('Database not configured for portal video progress.')
      }
      return { progressData: [] }
    }

return cached<{ progressData: PracticeProgressRow[] }>(
      PortalVideoProgressService.progressListKey(skfId),
      30,
      async () => {
        const { data, error } = await supabaseAdmin
          .from('video_progress')
          .select('*')
          .eq('skf_id', skfId)
          .order('last_watched', { ascending: false })

        if (error) {
          throw error
        }

        return {
          progressData: (data || []).map((entry) => ({
            videoId: String(entry.video_id),
            progressPercent: Number(entry.watched_percent) || 0,
            completed: Boolean(entry.completed),
            lastWatchedAt: String(entry.last_watched || ''),
            watchedSeconds: Number(entry.watched_seconds) || 0,
            practicedCount: Number(entry.practiced_count) || 0,
            lastPracticedAt: String(entry.last_practiced_at || '') || null,
          })),
        }
      }
    )
  }
}