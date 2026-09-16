import { NextResponse } from 'next/server'
import { getPortalAthleteFromCookies } from '@/lib/server/auth/require-portal-athlete'
import { getAllPracticePhotosAdmin } from '@/lib/server/repositories/portal-content-live'
import { supabaseAdmin } from '@/lib/server/supabase'
import { cached } from '@/src/server/lib/cache'
import { logger } from '@/src/server/lib/logger'

export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const athleteContext = await getPortalAthleteFromCookies()
  if (!athleteContext) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const { id } = await props.params
  if (!id) {
    return new NextResponse('Bad Request', { status: 400 })
  }

  const photos = await getAllPracticePhotosAdmin()
  const photo = photos.find(p => p.id === id)
  if (!photo || !photo.isPublished) {
    return new NextResponse('Not Found', { status: 404 })
  }
  
  const cacheKey = `portal:photo_url:${photo.id}`
  const cachedUrl = await cached<string | null>(cacheKey, 25 * 60, async () => {
    const { data, error } = await supabaseAdmin.storage.from('portal-practice-images').createSignedUrl(photo.storagePath, 60 * 30)
    if (error || !data?.signedUrl) {
      logger.warn('portal_content.practice_photo_sign_failed', { photoId: photo.id, error })
      return null
    }
    return data.signedUrl
  })

  if (!cachedUrl) {
    return new NextResponse('Internal Server Error', { status: 500 })
  }

  return NextResponse.redirect(cachedUrl)
}
