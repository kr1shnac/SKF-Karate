import { videoProgressBatchSchema } from '@/src/server/api/validators/portal.validator'
import { ok } from '@/src/server/lib/response'
import { withRoute } from '@/src/server/lib/route'
import { PortalVideoProgressService } from '@/src/server/services/portal-video-progress.service'

export const POST = withRoute(
  {
    bodySchema: videoProgressBatchSchema,
    auth: { type: 'portal', roles: ['student'] },
    rateLimit: { tier: 'write' },
    cacheControl: 'private, no-store',
  },
  async ({ portalSession, body }) => {
    const result = await PortalVideoProgressService.saveBatch(portalSession!.skfId!, body.entries)
    return ok(result)
  }
)
