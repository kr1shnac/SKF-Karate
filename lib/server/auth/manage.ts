import jwt from 'jsonwebtoken'
import { cookies } from 'next/headers'

import type { AuthUser } from '@/lib/server/auth/staff'
import { PORTAL_JWT_EXPIRY, PORTAL_SESSION_SECONDS } from '@/lib/server/auth/session-lifetime'
import { env, requireEnv } from '@/src/server/config/env'

/**
 * Staff "Practice Manager" session.
 *
 * The athlete portal issues its own athlete-scoped JWT (`skf_portal_token`);
 * this cookie is a separate, manager-scoped token so staff can reorder and
 * configure practice content from the website without touching their athlete
 * session or the external FeeTrack app.
 */
export const STAFF_COOKIE_NAME = 'skf_staff_token'

export interface StaffJWT {
  sub: string
  name: string
  role: string
  branchScope: string
  iat: number
  exp: number
}

/** Roles allowed to manage practice content (matches FeeTrack's write roles). */
export const MANAGE_WRITE_ROLES = new Set(['admin', 'instructor', 'fee_manager'])

function getSecret(): string {
  return requireEnv('JWT_SECRET')
}

export function createStaffJWT(user: AuthUser): string {
  return jwt.sign(
    { sub: user.id, name: user.name, role: user.role, branchScope: user.branchScope },
    getSecret(),
    { expiresIn: PORTAL_JWT_EXPIRY, issuer: 'skf-manage', audience: 'skf-manage-page' },
  )
}

export function verifyStaffJWT(token: string): StaffJWT | null {
  try {
    return jwt.verify(token, getSecret(), {
      issuer: 'skf-manage',
      audience: 'skf-manage-page',
    }) as StaffJWT
  } catch {
    return null
  }
}

export function buildStaffCookie(token: string): string {
  const isSecure = env.NODE_ENV === 'production'
  const secureFlag = isSecure ? '; Secure' : ''
  return `${STAFF_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${PORTAL_SESSION_SECONDS}${secureFlag}`
}

export function buildStaffCookieClear(): string {
  return `${STAFF_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

/** Server components / pages: read the manager from the cookie jar. */
export async function getManagerFromCookies(): Promise<StaffJWT | null> {
  const store = await cookies()
  const token = store.get(STAFF_COOKIE_NAME)?.value
  return token ? verifyStaffJWT(token) : null
}

/** API routes: read the manager straight from a Request. */
export function getManagerFromRequest(request: Request): StaffJWT | null {
  const cookieHeader = request.headers.get('cookie') || ''
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${STAFF_COOKIE_NAME}=([^;]+)`))
  if (!match) return null
  return verifyStaffJWT(match[1])
}

export function isManageWriteRole(role: string): boolean {
  return MANAGE_WRITE_ROLES.has(role)
}