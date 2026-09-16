import { notFound } from 'next/navigation'

import { requirePortalAthlete } from '@/lib/server/auth/require-portal-athlete'
import { getAthleteBySkfIdLive } from '@/lib/server/repositories/athletes-live'
import { getPracticeFolderPathForAthlete, getPracticeLessonForAthlete } from '@/lib/server/repositories/portal-content-live'
import { PortalVideoProgressService } from '@/src/server/services/portal-video-progress.service'

import DirectPracticeLesson from './DirectPracticeLesson'

export default async function DirectPracticeLessonPage({ params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params
  const portal = await requirePortalAthlete({ callbackUrl: `/portal/videos/${encodeURIComponent(videoId)}` })
  const session = portal.session
  const athlete = portal.athlete || (session.skfId ? await getAthleteBySkfIdLive(session.skfId) : null)
  if (!athlete) notFound()

  const [lesson, progress] = await Promise.all([
    getPracticeLessonForAthlete(videoId, {
      branchName: athlete.branchName || session.branch || '',
      batch: athlete.batch || session.batch || '',
      belt: athlete.currentBelt || session.belt || '',
    }),
    session.skfId ? PortalVideoProgressService.list(session.skfId) : Promise.resolve({ progressData: [] }),
  ])
  if (!lesson) notFound()
  const resumeData = progress.progressData.find((entry) => String(entry.videoId) === String(videoId))
  const folderPath = lesson.folderId ? await getPracticeFolderPathForAthlete(lesson.folderId) : []
  return <DirectPracticeLesson lesson={lesson} initialProgressPercent={resumeData?.progressPercent || 0} initialWatchedSeconds={resumeData?.watchedSeconds || 0} initialPracticedCount={resumeData?.practicedCount || 0} folderPath={folderPath} />
}
