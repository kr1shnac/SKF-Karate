import { isSupabaseReady, supabaseAdmin } from '@/lib/server/supabase'
import type { AuthUser } from '@/lib/server/auth/staff'
import { AppError, AuthenticationError, AuthorizationError, ValidationError } from '@/src/server/lib/errors'
import { logger } from '@/src/server/lib/logger'
import { timingSafeStringEqual } from '@/src/server/lib/security'
import { FeeOperationsService } from '@/src/server/services/fee-operations.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PRACTICE_BUCKET = 'portal-practice-images'
const WRITE_ROLES = new Set(['admin', 'instructor', 'fee_manager'])
const FEE_TRACK_ROLES = new Set(FeeOperationsService.roles)
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp'])
const SIGNED_URL_TTL_SECONDS = 60

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function isValidStoragePath(path: string) {
  if (!path || path.length > 300) return false
  if (path.startsWith('/') || path.includes('\\')) return false
  if (path.includes('..')) return false
  if (path.split('/').some((segment) => !/^[A-Za-z0-9._-]+$/.test(segment))) return false
  return IMAGE_EXTENSIONS.has(path.slice(path.lastIndexOf('.')))
}

function assertIntegrationAccess(request: Request, staff: AuthUser | null) {
  const expected = process.env.FEETRACK_API_KEY
  if (!expected || !timingSafeStringEqual(request.headers.get('x-feetrack-api-key') || '', expected)) {
    throw new AuthenticationError('Invalid FeeTrack integration key.')
  }
  if (!staff?.id || !staff.role || !FEE_TRACK_ROLES.has(staff.role)) {
    throw new AuthenticationError('FeeTrack staff session is required.')
  }
  if (!WRITE_ROLES.has(staff.role)) {
    throw new AuthorizationError('Fee viewer access is read-only.')
  }
}

export async function GET(request: Request) {
  try {
    const path = String(new URL(request.url).searchParams.get('path') || '').trim()
    const rawStaff = String(new URL(request.url).searchParams.get('staff') || '')
    const staff = rawStaff ? JSON.parse(rawStaff) as AuthUser : null
    assertIntegrationAccess(request, staff)

    if (!isValidStoragePath(path)) {
      throw new ValidationError({ path: ['Invalid practice photo storage path.'] })
    }
    if (!isSupabaseReady()) {
      throw new AppError('EXTERNAL_SERVICE_ERROR', 'Supabase storage is not configured for practice photos.', 503)
    }

    const { data, error } = await supabaseAdmin.storage.from(PRACTICE_BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
    if (error || !data?.signedUrl) {
      throw new AppError('EXTERNAL_SERVICE_ERROR', error?.message || 'Unable to resolve practice photo.', 503)
    }

    const upstream = await fetch(data.signedUrl, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
    if (!upstream.ok || !upstream.body) {
      throw new AppError('EXTERNAL_SERVICE_ERROR', `Practice photo unavailable (${upstream.status}).`, upstream.status || 502)
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'Content-Type': upstream.headers.get('Content-Type') || 'image/jpeg',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    logger.warn('feetrack.practice_photo_preview_failed', { error })
    if (error instanceof AppError) {
      return json({ success: false, error: error.message, code: error.code, details: error.details }, error.statusCode)
    }
    return json({ success: false, error: error instanceof Error ? error.message : 'Practice photo preview failed.' }, 500)
  }
}