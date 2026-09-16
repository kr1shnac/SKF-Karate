import { applySharedPracticeCompletion, getPracticeLibraryForAthlete } from '@/lib/server/repositories/portal-content-live'
import { ok } from '@/src/server/lib/response'
import { withRoute } from '@/src/server/lib/route'
import { PortalRecommendationService } from '@/src/server/services/portal-recommendation.service'
import { PortalVideoProgressService } from '@/src/server/services/portal-video-progress.service'

export const GET = withRoute(
  {
    auth: { type: 'portal', roles: ['student'] },
    rateLimit: { tier: 'authed' },
    cacheControl: 'private, no-store',
  },
  async ({ portalSession }) => {
    // withRoute middleware already validated the athlete exists and is eligible.
    // Use session claims directly to avoid a redundant getAthleteBySkfIdLive call.
    const [library, progress] = await Promise.all([
      getPracticeLibraryForAthlete({
        branchName: portalSession!.branch || '',
        batch: portalSession!.batch || '',
        belt: portalSession!.belt || '',
      }),
      PortalVideoProgressService.list(portalSession!.skfId!),
    ])
    const visibleVideos = [
      ...library.folders.flatMap((folder) => folder.videos),
      ...library.unfiledVideos,
    ]
    const folderTitleById = new Map(library.folders.map((folder) => [folder.id, folder.title]))
    const visibleVideosWithSeries = visibleVideos.map((video) =>
      video.folderId ? { ...video, folderTitle: folderTitleById.get(video.folderId) || '' } : video
    )
    const derivedProgress = applySharedPracticeCompletion(library.folders, progress.progressData)
    const decision = await PortalRecommendationService.decideAndStore({
      skfId: portalSession!.skfId!,
      videos: visibleVideosWithSeries,
      progress: derivedProgress,
      athleteBelt: portalSession!.belt || '',
    })

    return ok({
      ...library,
      audience: {
        belt: portalSession!.belt || '',
      },
      progressData: derivedProgress,
      recentlyAddedCutoff: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      recommendedVideoId: decision.pick?.videoId || '',
      recommendationReason: decision.pick?.reasonLabel || '',
    })
  }
)
