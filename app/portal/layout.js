import './portal.css'
import AthleteHubNav from '@/app/_components/portal/AthleteHubNav'
import { buildNoIndexMetadata } from '@/data/constants/seo'

import { getPortalAthleteFromCookies } from '@/lib/server/auth/require-portal-athlete'
import { isBBCandidate } from '@/lib/server/repositories/blackbelt-live'

export const metadata = buildNoIndexMetadata(
  '/portal',
  'Access your SKF Karate athlete profile, home practice videos, certificates, rankings, timetable, and fees through the private athlete portal.'
)

export default async function PortalLayout({ children }) {
  let portal = null
  let isBlackBeltCandidate = false

  try {
    portal = await getPortalAthleteFromCookies()
    isBlackBeltCandidate = await isBBCandidate(portal?.session?.skfId)
  } catch {
    isBlackBeltCandidate = false
  }

  return (
    <div className="hub-layout">
      <AthleteHubNav 
        isBlackBeltCandidate={isBlackBeltCandidate} 
        currentSession={portal?.session}
        currentAthlete={portal?.athlete}
      />
      <main className="hub-main">
        {children}
      </main>
    </div>
  )
}
