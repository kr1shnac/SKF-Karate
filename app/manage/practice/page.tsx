import { getAllBranches } from '@/lib/classesData'
import { BELTS } from '@/data/constants/belts'
import {
  getAllPortalVideosAdmin,
  getAllPracticeFoldersAdmin,
  getAllPracticePhotosAdmin,
} from '@/lib/server/repositories/portal-content-live'
import { getManagerFromCookies } from '@/lib/server/auth/manage'
import './practice-manager.css'
import PracticeManager from './PracticeManagerClient'

export const metadata = {
  title: 'Practice Manager',
  description: 'Reorder and target the athlete practice library.',
}

export default async function PracticeManagerPage() {
  const [staff, videos, folders, photos] = await Promise.all([
    getManagerFromCookies(),
    getAllPortalVideosAdmin(),
    getAllPracticeFoldersAdmin(),
    getAllPracticePhotosAdmin(),
  ])

  return (
    <PracticeManager
      staff={staff}
      videos={videos}
      folders={folders}
      photos={photos}
      branches={getAllBranches()}
      belts={BELTS.map((belt) => belt.colour)}
    />
  )
}