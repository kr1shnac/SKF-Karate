import { ok } from '@/src/server/lib/response'
import { withRoute } from '@/src/server/lib/route'
import { PortalVideoProgressService } from '@/src/server/services/portal-video-progress.service'

export const POST = withRoute(
  {
    auth: { type: 'portal', roles: ['student'] },
    rateLimit: { tier: 'write' },
    cacheControl: 'private, no-store',
  },
  async ({ portalSession, params }) => {
    const videoId = String(params?.videoId || '')
    const result = await PortalVideoProgressService.recordPracticed(portalSession!.skfId!, videoId)
    return ok(result)
  }
)