import { requirePortalAthlete } from '@/lib/server/auth/require-portal-athlete'
import { applySharedPracticeCompletion, getPracticeLibraryForAthlete } from '@/lib/server/repositories/portal-content-live'
import { logger } from '@/src/server/lib/logger'
import { PortalVideoProgressService } from '@/src/server/services/portal-video-progress.service'
import { PortalRecommendationService } from '@/src/server/services/portal-recommendation.service'

import VideosClient from './VideosClient'
import './videos.css'

export default async function PortalVideosPage() {
  const { athlete, session } = await requirePortalAthlete({ callbackUrl: '/portal/videos' })
  let initialPayload = null

  try {
    const [library, progress] = await Promise.all([
      getPracticeLibraryForAthlete({
        branchName: athlete.branchName || session.branch || '',
        batch: athlete.batch || session.batch || '',
        belt: athlete.currentBelt || session.belt || '',
      }),
      PortalVideoProgressService.list(session.skfId),
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
      skfId: session.skfId,
      videos: visibleVideosWithSeries,
      progress: derivedProgress,
      athleteBelt: athlete.currentBelt || session.belt || '',
    })
    initialPayload = {
      ...library,
      progressData: derivedProgress,
      recentlyAddedCutoff: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      recommendedVideoId: decision.pick?.videoId || '',
      recommendationReason: decision.pick?.reasonLabel || '',
    }
  } catch (error) {
    logger.warn('portal.videos_page_library_failed', {
      skfId: session.skfId,
      branch: athlete.branchName || session.branch || '',
      batch: athlete.batch || session.batch || '',
      belt: athlete.currentBelt || session.belt || '',
      error,
    })
  }

  return <VideosClient initialPayload={initialPayload} />
}
