import { NextResponse } from 'next/server'

import { getManagerFromRequest, isManageWriteRole } from '@/lib/server/auth/manage'
import { updatePortalVideo } from '@/lib/server/repositories/portal-content-live'
import { revalidatePortalSitePaths } from '@/lib/server/revalidation'

/** Update a video's audience (belts / branches / batches) or publish state. */
export async function PATCH(request: Request) {
  const session = getManagerFromRequest(request)
  if (!session || !isManageWriteRole(session.role)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  let videoId = ''
  const patch: { branchSlugs?: string[]; batchNames?: string[]; beltLevels?: string[]; isPublished?: boolean } = {}
  try {
    const body = (await request.json()) as Record<string, unknown>
    videoId = String(body.videoId || '').trim()
    if ('branchSlugs' in body) patch.branchSlugs = toTextList(body.branchSlugs)
    if ('batchNames' in body) patch.batchNames = toTextList(body.batchNames)
    if ('beltLevels' in body) patch.beltLevels = toTextList(body.beltLevels)
    if ('isPublished' in body) patch.isPublished = Boolean(body.isPublished)
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!videoId) {
    return NextResponse.json({ error: 'Video ID is required.' }, { status: 400 })
  }
  if (!('branchSlugs' in patch) && !('batchNames' in patch) && !('beltLevels' in patch) && !('isPublished' in patch)) {
    return NextResponse.json({ error: 'At least one field is required.' }, { status: 400 })
  }

  const video = await updatePortalVideo(videoId, patch)
  revalidatePortalSitePaths()

  return NextResponse.json({ success: true, data: { video } })
}

function toTextList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((entry) => String(entry || '').trim()).filter(Boolean) : []
}