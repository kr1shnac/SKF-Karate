import { NextResponse } from 'next/server'

import { buildStaffCookieClear } from '@/lib/server/auth/manage'

export async function POST() {
  return NextResponse.json(
    { success: true },
    { headers: { 'Set-Cookie': buildStaffCookieClear() } },
  )
}