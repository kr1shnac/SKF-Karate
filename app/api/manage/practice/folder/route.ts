import { NextResponse } from 'next/server'

import { getManagerFromRequest, isManageWriteRole } from '@/lib/server/auth/manage'
import { updatePracticeFolder } from '@/lib/server/repositories/portal-content-live'
import { revalidatePortalSitePaths } from '@/lib/server/revalidation'

/** Folders are organisational shelves: only visibility is editable. */
export async function PATCH(request: Request) {
  const session = getManagerFromRequest(request)
  if (!session || !isManageWriteRole(session.role)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  let folderId = ''
  let isPublished: boolean | undefined
  try {
    const body = (await request.json()) as Record<string, unknown>
    folderId = String(body.folderId || '').trim()
    if (typeof body.isPublished === 'boolean') isPublished = body.isPublished
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!folderId) {
    return NextResponse.json({ error: 'Folder ID is required.' }, { status: 400 })
  }
  if (isPublished === undefined) {
    return NextResponse.json({ error: 'Only isPublished can be edited on a folder.' }, { status: 400 })
  }

  const folder = await updatePracticeFolder(folderId, { isPublished })
  revalidatePortalSitePaths()

  return NextResponse.json({ success: true, data: { folder } })
}