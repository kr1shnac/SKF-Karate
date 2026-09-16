import { requirePortalAthlete } from '@/lib/server/auth/require-portal-athlete'
import AthleteProfileClient from '@/app/_components/athlete/profile/AthleteProfileClient'
import { buildRestoredAthleteProfileData } from '@/app/_components/athlete/profile/athleteProfileData'
import {
  getAthleteRankLive,
} from '@/lib/server/repositories/athletes-live'
import { getUpcomingPortalEventsLive } from '@/lib/server/repositories/events-live'
import { getBranchCoachNameMapLiveFocused } from '@/lib/server/repositories/senseis-live'

export default async function DojoDashboard() {
  const { athlete } = await requirePortalAthlete({ callbackUrl: '/portal/dashboard' })

  const [rankInfo, upcomingEvents, branchCoachMap] = await Promise.all([
    getAthleteRankLive(athlete.id),
    getUpcomingPortalEventsLive(athlete.skfId),
    getBranchCoachNameMapLiveFocused(),
  ])
  const profile = buildRestoredAthleteProfileData(athlete, rankInfo, upcomingEvents, branchCoachMap)

  return <AthleteProfileClient {...profile} isDashboardContext={true} />
}
