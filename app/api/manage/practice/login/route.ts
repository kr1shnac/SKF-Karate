import { NextResponse } from 'next/server'

import { authorizeStaffCredentials } from '@/lib/server/auth/staff'
import { buildStaffCookie, createStaffJWT, isManageWriteRole } from '@/lib/server/auth/manage'
import { applyRateLimit } from '@/src/server/lib/rate-limit'

export async function POST(request: Request) {
  try {
    await applyRateLimit(request, 'auth')
  } catch {
    return NextResponse.json({ error: 'Too many attempts. Try again shortly.' }, { status: 429 })
  }

  let username = ''
  let password = ''
  try {
    const body = await request.json()
    username = String((body as { username?: unknown })?.username || '')
    password = String((body as { password?: unknown })?.password || '')
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  const user = await authorizeStaffCredentials(username, password)
  if (!user || !isManageWriteRole(user.role)) {
    return NextResponse.json({ error: 'Invalid staff credentials.' }, { status: 401 })
  }

  const token = createStaffJWT(user)

  return NextResponse.json(
    { success: true, name: user.name, role: user.role },
    { headers: { 'Set-Cookie': buildStaffCookie(token) } },
  )
}