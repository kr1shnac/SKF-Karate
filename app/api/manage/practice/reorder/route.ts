import { NextResponse } from 'next/server'

import { getManagerFromRequest, isManageWriteRole } from '@/lib/server/auth/manage'
import { reorderPracticeContent } from '@/lib/server/repositories/portal-content-live'
import { revalidatePortalSitePaths } from '@/lib/server/revalidation'

const SCOPES = ['folders', 'videos', 'photos'] as const
type Scope = (typeof SCOPES)[number]

export async function POST(request: Request) {
  const session = getManagerFromRequest(request)
  if (!session || !isManageWriteRole(session.role)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  let scope = ''
  let orderedIds: string[] = []
  try {
    const body = await request.json()
    scope = String((body as { scope?: unknown })?.scope || '')
    const raw = (body as { orderedIds?: unknown })?.orderedIds
    orderedIds = Array.isArray(raw) ? raw.map((id) => String(id).trim()).filter(Boolean) : []
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  if (!SCOPES.includes(scope as Scope)) {
    return NextResponse.json({ error: 'Scope must be folders, videos or photos.' }, { status: 400 })
  }
  if (!orderedIds.length) {
    return NextResponse.json({ error: 'orderedIds must contain at least one content ID.' }, { status: 400 })
  }

  await reorderPracticeContent(scope as Scope, orderedIds)
  revalidatePortalSitePaths()

  return NextResponse.json({ success: true, data: { scope, orderedIds } })
}