import type { Session } from 'next-auth'
import { revalidatePath, revalidateTag } from 'next/cache'
import { ZodError } from 'zod'

import { ApiError } from '@/lib/server/api'
import {
  getPendingWebsiteSheetNotifications,
  markWebsiteSheetNotificationContacted,
} from '@/lib/server/sheets'
import { SHOP_PRODUCTS_CACHE_TAG } from '@/lib/shop/cache'
import { authorizeStaffCredentials, type AuthUser } from '@/lib/server/auth/staff'
import { getWebsiteAnalyticsSummary } from '@/lib/server/site-analytics'
import type { TournamentRecord } from '@/data/types'

import { getAllAthletesLive } from '@/lib/server/repositories/athletes-live'
import {
  createEventRecordLive,
  deleteEventRecordLive,
  getEventByIdAdminLive,
  updateEventRecordLive,
} from '@/lib/server/repositories/events-live'
import {
  createPracticeFolder,
  createPortalVideo,
  deletePracticeFolder,
  deletePracticePhoto,
  deletePortalVideo,
  getAllBranchTimetablesAdmin,
  getAllPracticeFoldersAdmin,
  getAllPracticePhotosAdmin,
  getAllPortalVideosAdmin,
  getHomePracticeAnalytics,
  reorderPracticeContent,
  updatePracticeFolder,
  updatePortalVideo,
} from '@/lib/server/repositories/portal-content-live'
import {
  createGalleryPhoto,
  deleteGalleryPhoto,
  GALLERY_CATEGORY_OPTIONS,
  getAllGalleryPhotosAdmin,
  getEventGalleryPhotosAdmin,
  updateGalleryPhoto,
} from '@/lib/server/repositories/gallery-live'
import {
  getAllShopOrders,
  getProducts,
  updateShopOrderStatus,
  upsertProduct,
  type SaveShopProductInput,
} from '@/lib/server/repositories/shop'
import {
  clearSyncedEventArtifactsFromAthletes,
  syncStandaloneEventResultsToAthletes,
  syncTournamentResultsToAthletes,
} from '@/lib/server/event-athlete-sync'
import {
  assignEventCertificateNumbers,
  listEventCertificates,
  prepareEventCertificates,
  publishEventCertificates,
  type CertificateNumberAssignment,
} from '@/lib/certificates/CertificateWorkflow'
import { resolveServerAthleteProfilePhoto } from '@/lib/server/profile-photos'
import {
  revalidateAthleteSitePaths,
  revalidateEventSitePaths,
  revalidatePortalSitePaths,
  revalidateTournamentSitePaths,
} from '@/lib/server/revalidation'
import {
  getAllBBCandidatesAcrossPrograms,
  updateBBCandidateAdmin,
} from '@/lib/server/repositories/blackbelt-live'
import {
  validateEventPayload,
  validateTournamentPayload,
} from '@/lib/server/validation'
import { normaliseSkfId } from '@/lib/utils/registration'
import {
  admissionBranchSettingsSchema,
  admissionListQuerySchema,
  admissionPromoCodeSchema,
  admissionRejectSchema,
} from '@/src/server/api/validators/admission.validator'
import {
  eventFeeConfigSchema,
  eventFeeDepositSchema,
  eventFeeExpenseSchema,
  eventFeeGenerateSchema,
  eventFeePreviewSchema,
  feeReminderSendSchema,
  feeTypeSchema,
  manualStudentFeeSchema,
} from '@/src/server/api/validators/fees.validator'
import { AppError, AuthenticationError, AuthorizationError, NotFoundError, RateLimitError, ValidationError } from '@/src/server/lib/errors'
import { logger } from '@/src/server/lib/logger'
import { applyRateLimit } from '@/src/server/lib/rate-limit'
import { timingSafeStringEqual } from '@/src/server/lib/security'
import { AdmissionService } from '@/src/server/services/admission.service'
import { EventFeesService } from '@/src/server/services/event-fees.service'
import { FeeOperationsService } from '@/src/server/services/fee-operations.service'
import {
  getFeeTrackPushPublicKey,
  saveFeeTrackPushSubscription,
} from '@/src/server/services/feetrack-push.service'

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

const FEE_TRACK_ROLES = new Set(FeeOperationsService.roles)
const FEE_TRACK_EVENT_WRITE_ROLES = new Set(['admin', 'instructor', 'fee_manager'])
const MAX_INTEGRATION_BODY_BYTES = 1024 * 1024

type ActionBody = Record<string, unknown> & {
  action?: string
  staff?: AuthUser
}

type FeeTrackSession = Session & {
  user: Session['user'] & {
    id: string
    name: string
    role: string
    branchScope?: string
  }
}

type LedgerEntry = {
  id?: string
  skfId: string
  feeType: string
  amount: number
  status: string
  receiptId?: string | null
  paidDate?: string | null
  sourceId?: string | null
  sourceLabel?: string | null
  dueDate?: string | null
  metadata?: Record<string, unknown>
  month?: string
  year?: number
}

type FeeTrackAthlete = {
  id?: string | null
  skfId?: string | null
  firstName?: string | null
  lastName?: string | null
  branchName?: string | null
  currentBelt?: string | null
  gender?: string | null
  photoUrl?: string | null
  status?: string | null
}

type FeeTrackEventParticipant = {
  id?: string | null
  athleteId?: string | null
  athleteName?: string | null
  skfId?: string | null
  branchName?: string | null
  belt?: string | null
  photoUrl?: string | null
}

type FeeTrackEventResult = Record<string, unknown> & {
  id?: string
  participantId?: string
  athleteId?: string
  athleteName?: string
  skfId?: string
  branchName?: string
  belt?: string
  photoUrl?: string
  medal?: string
  result?: string
  position?: number | string
  category?: string
  ageGroup?: string
  weightCategory?: string
  difficultyLevel?: number | string
  wins?: number | string
  beltAwarded?: string
  promotion?: string
  promotionType?: string
  doublePromotion?: boolean
  examiner?: string
  grade?: string
  score?: number | string
  daysAttended?: number | string
  specialAward?: string
  award?: string
  awardRank?: number | string
  notes?: string
}

type FeeTrackEvent = Record<string, unknown> & {
  id: string
  slug?: string
  name: string
  shortName?: string
  type?: string
  level?: string
  status?: string
  date?: string
  endDate?: string
  venue?: string
  city?: string
  state?: string
  description?: string
  coverImageUrl?: string
  affiliatedBody?: string
  totalParticipants?: number
  skfParticipants?: number
  hostingBranch?: string
  isPublished?: boolean
  isFeatured?: boolean
  isResultsPublished?: boolean
  showInJourney?: boolean
  participants?: FeeTrackEventParticipant[]
  results?: FeeTrackEventResult[]
  winners?: FeeTrackEventResult[]
  resultsAppliedAt?: string
}

function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Cache-Control', 'private, no-store')
  responseHeaders.set('X-Content-Type-Options', 'nosniff')

  return Response.json(data, {
    status,
    headers: responseHeaders,
  })
}

async function applyIntegrationRateLimit(request: Request) {
  const rateLimit = await applyRateLimit(request, 'authed', 'feetrack-integration')
  if (!rateLimit.allowed) {
    throw new RateLimitError(rateLimit.headers)
  }
  return rateLimit.headers
}

async function readActionBody(request: Request): Promise<ActionBody> {
  const contentLength = request.headers.get('content-length')
  if (contentLength) {
    const parsedLength = Number(contentLength)
    if (Number.isFinite(parsedLength) && parsedLength > MAX_INTEGRATION_BODY_BYTES) {
      throw new ValidationError({
        body: [`Request body exceeds ${MAX_INTEGRATION_BODY_BYTES} bytes.`],
      })
    }
  }

  let text: string
  try {
    text = await request.text()
  } catch {
    throw new ValidationError({ body: ['Invalid request body.'] })
  }

  const byteLength = new TextEncoder().encode(text).byteLength
  if (byteLength > MAX_INTEGRATION_BODY_BYTES) {
    throw new ValidationError({
      body: [`Request body exceeds ${MAX_INTEGRATION_BODY_BYTES} bytes.`],
    })
  }

  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Expected JSON object.')
    }
    return parsed as ActionBody
  } catch {
    throw new ValidationError({ body: ['Invalid JSON body.'] })
  }
}

function integrationContext(body: ActionBody | null) {
  return {
    action: body?.action || 'unknown',
    branch: body?.branch,
    status: body?.status,
    month: body?.month,
    year: body?.year,
  }
}

function assertApiKey(request: Request) {
  const expected = process.env.FEETRACK_API_KEY
  if (!expected) {
    throw new AppError(
      'FEETRACK_NOT_CONFIGURED',
      'FeeTrack integration API key is not configured.',
      503
    )
  }

  const actual = request.headers.get('x-feetrack-api-key') || ''
  if (!timingSafeStringEqual(actual, expected)) {
    throw new AuthenticationError('Invalid FeeTrack integration key.')
  }
}

function sessionFromStaff(staff: AuthUser): FeeTrackSession {
  return {
    expires: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    user: {
      id: staff.id,
      name: staff.name || staff.id,
      role: staff.role,
      branchScope: staff.branchScope || 'all',
    },
  } as FeeTrackSession
}

function assertStaff(body: ActionBody) {
  if (!body.staff?.id || !body.staff.role) {
    throw new AuthenticationError('FeeTrack staff session is required.')
  }

  if (!FEE_TRACK_ROLES.has(body.staff.role)) {
    throw new AuthorizationError('This staff account cannot access FeeTrack.')
  }

  return sessionFromStaff(body.staff)
}

function normalizeKey(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeBranch(value: unknown, options: { allowOverall?: boolean } = {}) {
  const raw = String(value || '').trim()
  const key = normalizeKey(raw)

  if (options.allowOverall && (!key || key === 'overall' || key === 'all' || key === 'both')) {
    return ''
  }

  if (['mpsc', 'mp', 'mp sports club', 'm p sports club'].includes(key)) {
    return 'M P Sports Club'
  }

  if (['herohalli', 'hero'].includes(key)) {
    return 'Herohalli'
  }

  throw new ValidationError({ branch: ['FeeTrack currently supports only M P Sports Club and Herohalli.'] })
}

function normalizeScope(value: unknown) {
  const key = normalizeKey(value)
  if (['mpsc', 'mp', 'mp sports club', 'm p sports club'].includes(key)) return 'M P Sports Club'
  if (['herohalli', 'hero'].includes(key)) return 'Herohalli'
  if (!key || key === 'both' || key === 'all' || key === 'bangalore') return 'Both'
  return String(value || '').trim() || 'Both'
}

function feeTrackScope(value: unknown) {
  const key = normalizeKey(value)
  if (['m p sports club', 'mp sports club', 'mpsc', 'mp'].includes(key)) return 'MPSC'
  if (key === 'herohalli') return 'Herohalli'
  if (!key || key === 'both' || key === 'all' || key === 'bangalore') return 'Both'
  return String(value || '').trim() || 'Both'
}

function assertEventWrite(session: FeeTrackSession) {
  if (!FEE_TRACK_EVENT_WRITE_ROLES.has(session.user.role)) {
    throw new AuthorizationError('Fee viewer access is read-only.')
  }
}

function sessionBranchScope(session: FeeTrackSession) {
  return String(session.user.branchScope || 'all').trim()
}

function canAccessBranch(session: FeeTrackSession, branch?: string | null) {
  const scope = normalizeKey(sessionBranchScope(session))
  if (!scope || scope === 'all') return true
  const branchKey = normalizeKey(branch)
  if (!branchKey) return true
  return branchKey === scope
}

function assertBranchAccess(session: FeeTrackSession, branch?: string | null) {
  if (!canAccessBranch(session, branch)) {
    throw new AuthorizationError('This event is outside your branch scope.')
  }
}

function defaultEventBranch(session: FeeTrackSession) {
  const scope = normalizeKey(sessionBranchScope(session))
  if (!scope || scope === 'all') return ''
  return normalizeBranch(sessionBranchScope(session))
}

function slugify(value: unknown) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

function nameForAthlete(athlete: FeeTrackAthlete) {
  return [athlete.firstName, athlete.lastName].filter(Boolean).join(' ').trim() || String(athlete.skfId || 'SKF Athlete')
}

function resolvedProfilePhoto(source: {
  skfId?: string | null
  photoUrl?: string | null
  gender?: string | null
}) {
  return resolveServerAthleteProfilePhoto({
    skfId: source.skfId || '',
    photoUrl: source.photoUrl || '',
    gender: source.gender || '',
  })
}

function mapAthleteForFeeTrack(athlete: FeeTrackAthlete) {
  return {
    id: String(athlete.id || ''),
    skfId: String(athlete.skfId || ''),
    firstName: String(athlete.firstName || ''),
    lastName: String(athlete.lastName || ''),
    branchName: String(athlete.branchName || ''),
    currentBelt: String(athlete.currentBelt || ''),
    photoUrl: resolvedProfilePhoto(athlete),
  }
}

function mapEventParticipant(participant: FeeTrackEventParticipant) {
  return {
    id: String(participant.id || ''),
    athleteId: String(participant.athleteId || ''),
    athleteName: String(participant.athleteName || participant.skfId || 'SKF Athlete'),
    skfId: String(participant.skfId || ''),
    branchName: String(participant.branchName || ''),
    belt: String(participant.belt || ''),
    photoUrl: resolvedProfilePhoto(participant),
  }
}

function mapEventResult(result: FeeTrackEventResult) {
  return {
    ...result,
    photoUrl: resolvedProfilePhoto({
      skfId: String(result.skfId || ''),
      photoUrl: String(result.photoUrl || ''),
    }),
  }
}

function mapEventForFeeTrack(event: FeeTrackEvent) {
  return {
    id: event.id,
    slug: event.slug || '',
    name: event.name,
    shortName: event.shortName || event.name,
    type: event.type || '',
    level: event.level || '',
    status: event.status || '',
    date: event.date || '',
    endDate: event.endDate || '',
    venue: event.venue || '',
    city: event.city || '',
    state: event.state || '',
    description: event.description || '',
    coverImageUrl: event.coverImageUrl || '',
    affiliatedBody: event.affiliatedBody || '',
    totalParticipants: Number(event.totalParticipants || 0),
    skfParticipants: Number(event.skfParticipants || 0),
    hostingBranch: event.hostingBranch || '',
    isPublished: Boolean(event.isPublished),
    isFeatured: Boolean(event.isFeatured),
    isResultsPublished: Boolean(event.isResultsPublished),
    showInJourney: Boolean(event.showInJourney),
    participants: (event.participants || []).map(mapEventParticipant),
    results: Array.isArray(event.results) ? event.results.map(mapEventResult) : [],
    resultsAppliedAt: event.resultsAppliedAt || '',
  }
}

function collectParticipantSkfIds(event: FeeTrackEvent | null | undefined) {
  return new Set(
    (event?.participants || [])
      .map((participant) => normaliseSkfId(String(participant.skfId || '')))
      .filter(Boolean)
  )
}

async function withLegacyApiError<T>(callback: () => Promise<T> | T) {
  try {
    return await callback()
  } catch (error) {
    if (error instanceof ApiError) {
      const status = Number.isFinite(error.status) ? error.status : 400
      const code = status === 409 ? 'CONFLICT' : status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR'
      throw new AppError(code, error.message, status, error.details)
    }
    throw error
  }
}

function monthName(input: unknown) {
  if (typeof input === 'number' || /^\d+$/.test(String(input || '').trim())) {
    const index = Number(input)
    if (index >= 0 && index < MONTHS.length) return MONTHS[index]
  }

  const key = String(input || '').trim().toLowerCase()
  const match = MONTHS.find((month) => {
    const lower = month.toLowerCase()
    return lower === key || lower.slice(0, 3) === key.slice(0, 3)
  })

  return match || MONTHS[new Date().getMonth()]
}

function monthNameFromDateValue(input: unknown) {
  const raw = String(input || '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const parsed = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`)
    if (Number.isFinite(parsed.getTime())) return MONTHS[parsed.getUTCMonth()]
  }
  return monthName(input)
}

function monthIndex(input: unknown) {
  const normalized = monthName(input)
  return MONTHS.findIndex((month) => month === normalized)
}

function optionalMonthIndex(input: unknown) {
  const raw = String(input || '').trim()
  if (!raw) return null
  return monthIndex(raw)
}

function targetYear(input: unknown) {
  const year = Number(input || new Date().getFullYear())
  return Number.isFinite(year) ? Math.trunc(year) : new Date().getFullYear()
}

function statusToMonthStatus(status: string) {
  if (status === 'paid') return 'Paid'
  if (status === 'break') return 'Break'
  if (status === 'discontinued') return 'Discontinued'
  if (status === 'waived') return 'N/A'
  if (status === 'pending_verification') return 'Pending Verification'
  return 'Pending'
}

function readAmount(value: unknown) {
  const amount = Number(value || 0)
  return Number.isFinite(amount) ? Math.max(0, amount) : 0
}

function readSignedAmount(value: unknown) {
  const amount = Number(value || 0)
  return Number.isFinite(amount) ? amount : 0
}

function hasAmount(value: unknown) {
  return value !== undefined && value !== null && value !== ''
}

function stringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry || '').trim()).filter(Boolean)
  }
  const single = String(value || '').trim()
  return single ? [single] : []
}

function compactDate(value: unknown) {
  return String(value || '').split('T')[0] || ''
}

async function getNonRecurringRows(session: FeeTrackSession, year: number, branch: string) {
  const ledger = await FeeOperationsService.getLedger(session, {
    year,
    city: 'bangalore',
    branch,
    feeType: 'all',
  })
  const bySkfId = new Map<string, { admission?: LedgerEntry; dress?: LedgerEntry; eventDues: LedgerEntry[] }>()

  for (const entry of ledger.entries as LedgerEntry[]) {
    if (!['admission', 'dress', 'belt_exam', 'tournament', 'event', 'other'].includes(entry.feeType)) continue
    const current = bySkfId.get(entry.skfId) || { eventDues: [] }
    if (entry.feeType === 'admission' && !current.admission) current.admission = entry
    if (entry.feeType === 'dress' && !current.dress) current.dress = entry
    if (['belt_exam', 'tournament', 'event', 'other'].includes(entry.feeType)) current.eventDues.push(entry)
    bySkfId.set(entry.skfId, current)
  }

  return bySkfId
}

function mapStudent(
  row: Record<string, unknown>,
  extras?: { admission?: LedgerEntry; dress?: LedgerEntry; eventDues?: LedgerEntry[] },
  period?: { month: string; year: number }
) {
  const rawStatus = String(row.status || 'due')
  const billingStatus = normalizeKey(row.billingStatus)
  const status = billingStatus === 'discontinued' && rawStatus === 'waived'
    ? 'discontinued'
    : rawStatus
  const joinDate = String(row.joinDate || '')
  const joined = joinDate ? new Date(joinDate) : null
  const admission = extras?.admission
  const dress = extras?.dress
  const eventDues = (extras?.eventDues || []).map((due) => ({
    id: String(due.id || ''),
    eventId: String(due.sourceId || ''),
    label: String(due.sourceLabel || ledgerCategoryLabel(due.feeType)),
    feeType: String(due.feeType || 'event'),
    amount: readAmount(due.amount),
    status: String(due.status || 'due'),
    receiptId: due.receiptId || null,
    dueDate: String(due.dueDate || ''),
    month: due.month || '',
    year: due.year || 0,
    proofId: String(due.metadata?.latestProofId || '') || null,
  }))
  const monthStatus = statusToMonthStatus(status)
  const pendingFees: Array<Record<string, unknown>> = []

  if (row.feeRecordId && isReminderPayableStatus(status) && period) {
    const label = row.isExamInstallment
      ? 'Black Belt Exam Installment'
      : ledgerCategoryLabel('monthly')
    pendingFees.push({
      id: String(row.feeRecordId),
      feeRecordId: String(row.feeRecordId),
      feeType: 'monthly',
      label: pendingFeeLabel({ feeType: 'monthly', sourceLabel: label, month: period.month, year: period.year }),
      amount: readAmount(row.amount),
      status,
      month: period.month,
      monthIndex: monthIndex(period.month),
      year: period.year,
    })
  }

  if (admission && isReminderPayableStatus(admission.status)) {
    pendingFees.push({
      id: String(admission.id || ''),
      feeRecordId: String(admission.id || ''),
      feeType: 'admission',
      label: pendingFeeLabel({ feeType: 'admission', sourceLabel: admission.sourceLabel, month: admission.month, year: admission.year }),
      amount: readAmount(admission.amount),
      status: admission.status,
      month: admission.month || '',
      monthIndex: admission.month ? monthIndex(admission.month) : null,
      year: admission.year || 0,
    })
  }

  if (dress && isReminderPayableStatus(dress.status)) {
    pendingFees.push({
      id: String(dress.id || ''),
      feeRecordId: String(dress.id || ''),
      feeType: 'dress',
      label: pendingFeeLabel({ feeType: 'dress', sourceLabel: dress.sourceLabel, month: dress.month, year: dress.year }),
      amount: readAmount(dress.amount),
      status: dress.status,
      month: dress.month || '',
      monthIndex: dress.month ? monthIndex(dress.month) : null,
      year: dress.year || 0,
    })
  }

  for (const due of eventDues) {
    if (!isReminderPayableStatus(due.status)) continue
    pendingFees.push({
      id: due.id,
      feeRecordId: due.id,
      feeType: due.feeType,
      label: pendingFeeLabel({ feeType: due.feeType, sourceLabel: due.label, month: due.month, year: due.year }),
      amount: due.amount,
      status: due.status,
      month: due.month,
      monthIndex: due.month ? monthIndex(due.month) : null,
      year: due.year,
      eventId: due.eventId,
      dueDate: due.dueDate,
    })
  }

  return {
    id: row.skfId,
    name: row.name,
    parentName: row.parentName || '',
    status: monthStatus === 'Discontinued'
      ? 'Discontinued'
      : monthStatus === 'Break'
        ? 'Break'
        : 'Active',
    fee: readAmount(row.amount),
    phone: row.phone || '',
    whatsapp: row.phone || '',
    dateOfBirth: row.dateOfBirth || '',
    email: row.email || '',
    gender: row.gender || '',
    photoUrl: row.photoUrl || '',
    hasProfilePhoto: Boolean(row.hasProfilePhoto),
    paid: status === 'paid',
    monthStatus,
    joinMonth: joined && Number.isFinite(joined.getTime()) ? joined.getMonth() : 0,
    originalFee: readAmount(row.originalAmount),
    creditApplied: readAmount(row.creditApplied),
    trainingMonths: readAmount(row.trainingMonths),
    trainingExperience: String(row.trainingExperience || ''),
    receiptId: row.receiptId || null,
    paidDate: row.paidDate || null,
    admissionFee: admission ? readAmount(admission.amount) : undefined,
    admissionStatus: admission?.status === 'paid' ? 'Paid' : admission ? 'Pending' : undefined,
    admissionReceiptId: admission?.receiptId || null,
    dressFee: dress ? readAmount(dress.amount) : undefined,
    dressCost: dress ? readAmount(dress.metadata?.dressCost) : undefined,
    dressStatus: dress?.status === 'paid' ? 'Paid' : dress ? 'Pending' : undefined,
    dressReceiptId: dress?.receiptId || null,
    eventDues,
    pendingFees,
    pendingFeeTotal: pendingFees.reduce((sum, fee) => sum + readAmount(fee.amount), 0),
  }
}

function mapCredit(row: Record<string, unknown>) {
  return {
    id: String(row.id || ''),
    studentId: String(row.skf_id || ''),
    studentName: String(row.athleteName || 'SKF Athlete'),
    amount: readAmount(row.amount),
    reason: String(row.reason || ''),
    dateEarned: compactDate(row.earned_at || row.created_at),
    usedInMonth: row.used_month ? monthIndex(row.used_month) : null,
    usedDate: compactDate(row.used_at),
    isUsed: String(row.status || '') === 'used',
    description: String(row.description || ''),
  }
}

function mapExpense(row: Record<string, unknown>) {
  return {
    id: String(row.id || row.expense_code || ''),
    month: monthIndex(row.month),
    year: String(row.year || new Date().getFullYear()),
    title: String(row.title || ''),
    description: String(row.description || ''),
    scope: feeTrackScope(row.scope),
    amount: readAmount(row.amount),
    dateAdded: compactDate(row.created_at),
  }
}

function mapPaymentProof(row: Record<string, unknown>) {
  const metadata = (row.metadata && typeof row.metadata === 'object')
    ? row.metadata as Record<string, unknown>
    : {}
  const proofMonth = metadata.month || row.month
  const proofYear = metadata.year || row.year

  return {
    id: String(row.id || ''),
    studentId: String(row.skf_id || ''),
    studentName: String(row.athleteName || 'SKF Athlete'),
    branch: feeTrackScope(row.branch),
    amount: readAmount(row.amount),
    submittedAt: String(row.submitted_at || ''),
    paymentReference: String(row.payment_reference || ''),
    proofUrl: String(row.signedUrl || ''),
    proofFilename: String(row.proof_filename || ''),
    feeType: String(metadata.feeType || 'monthly'),
    sourceLabel: String(metadata.sourceLabel || ''),
    month: optionalMonthIndex(proofMonth),
    monthName: proofMonth ? monthName(proofMonth) : '',
    year: proofYear ? targetYear(proofYear) : new Date().getFullYear(),
    status: String(row.status || 'submitted'),
  }
}

function mapDevelopmentFund(data: Record<string, unknown>) {
  const monthlyBreakdown = ((data.monthlyBreakdown as Record<string, unknown>[]) || []).map((row) => ({
    month: monthIndex(row.month),
    year: String(row.year || data.year || new Date().getFullYear()),
    collected: readAmount(row.collected),
    devFund: readAmount(row.devFund),
    spent: readAmount(row.spent),
    carryForward: readSignedAmount(row.carryForward),
  }))

  const expenses = ((data.expenses as Record<string, unknown>[]) || []).map(mapExpense)

  return {
    branch: 'All',
    monthlyBreakdown,
    expenses,
    totalContributions: readAmount(data.totalContributions),
    totalSpent: readAmount(data.totalSpent),
    availableBalance: readSignedAmount(data.availableBalance),
    reserveUsed: 0,
  }
}

async function login(body: ActionBody) {
  const username = String(body.username || '')
  const password = String(body.password || '')
  const staff = await authorizeStaffCredentials(username, password)
  if (!staff || !FEE_TRACK_ROLES.has(staff.role)) {
    throw new AuthenticationError('Invalid FeeTrack credentials.')
  }

  return {
    success: true,
    staff: {
      id: staff.id,
      name: staff.name || staff.id,
      role: staff.role,
      branchScope: staff.branchScope || 'all',
    },
  }
}

async function getStudents(session: FeeTrackSession, body: ActionBody) {
  const branch = normalizeBranch(body.branch)
  const year = targetYear(body.year)
  const month = monthName(body.month)
  const [studentData, breakData, waivedData, nonRecurring] = await Promise.all([
    FeeOperationsService.getStudents(session, {
      year,
      month,
      city: 'bangalore',
      branch,
    }),
    FeeOperationsService.getStudents(session, {
      year,
      month,
      city: 'bangalore',
      branch,
      status: 'break',
    }),
    FeeOperationsService.getStudents(session, {
      year,
      month,
      city: 'bangalore',
      branch,
      status: 'waived',
    }),
    getNonRecurringRows(session, year, branch),
  ])
  const billableStudents = studentData.students as Record<string, unknown>[]
  const breakStudents = (breakData.students as Record<string, unknown>[]) || []
  const discontinuedStudents = ((waivedData.students as Record<string, unknown>[]) || [])
    .filter((student) => normalizeKey(student.billingStatus) === 'discontinued')

  const bySkfId = new Map<string, Record<string, unknown>>()
  for (const student of [...billableStudents, ...breakStudents, ...discontinuedStudents]) {
    bySkfId.set(String(student.skfId || ''), student)
  }

  return {
    success: true,
    students: Array.from(bySkfId.values()).map((student: Record<string, unknown>) =>
      mapStudent(student, nonRecurring.get(String(student.skfId || '')), { month, year })
    ),
  }
}

async function markPaid(session: FeeTrackSession, body: ActionBody) {
  const branch = normalizeBranch(body.branch)
  const month = monthName(body.month)
  const year = targetYear(body.year)
  const feeType = feeTypeSchema.parse(body.feeType || 'monthly')
  const feeRecordId = body.feeRecordId ? String(body.feeRecordId) : undefined

  const result = await FeeOperationsService.runLedgerAction(session, {
    action: 'mark_paid',
    skfId: String(body.id || body.skfId || ''),
    month,
    year,
    feeType,
    feeRecordId,
    paymentMethod: 'manual',
    paymentReference: 'FeeTrack',
  })
  return { success: true, branch, data: result }
}

async function markPaidWithCredit(session: FeeTrackSession, body: ActionBody) {
  const month = monthName(body.month)
  const year = targetYear(body.year)
  const skfId = String(body.id || body.skfId || '')
  const creditResult = await FeeOperationsService.runLedgerAction(session, {
    action: 'apply_credit',
    creditId: String(body.creditId || ''),
    skfId,
    month,
    year,
    feeType: 'monthly',
  })

  const target = (creditResult as { target?: { status?: string; amount?: number } }).target
  let paidResult: unknown = creditResult
  if (target?.status !== 'paid') {
    paidResult = await FeeOperationsService.runLedgerAction(session, {
      action: 'mark_paid',
      skfId,
      month,
      year,
      feeType: 'monthly',
      amount: target?.amount,
      paymentMethod: 'manual',
      paymentReference: 'FeeTrack credit settlement',
    })
  }

  return { success: true, data: paidResult, credit: creditResult }
}

async function allocateExamFee(session: FeeTrackSession, body: ActionBody) {
  const branch = normalizeBranch(body.branch)
  const month = monthName(body.month)
  const year = targetYear(body.year)
  const amount = Number(body.amount) || 1500

  const result = await FeeOperationsService.runLedgerAction(session, {
    action: 'mark_due',
    skfId: String(body.id || body.skfId || ''),
    month,
    year,
    feeType: 'belt_exam',
    amount,
    reason: 'Allocated for Belt Examination',
  })

  return { success: true, branch, data: result }
}

async function createManualStudentFee(session: FeeTrackSession, body: ActionBody) {
  const input = manualStudentFeeSchema.parse({
    skfId: String(body.id || body.skfId || ''),
    month: monthName(body.month),
    year: targetYear(body.year),
    title: body.title,
    description: body.description,
    amount: body.amount,
    dueDate: body.dueDate,
  })

  const result = await FeeOperationsService.createManualStudentFee(session, input)
  return { success: true, data: result }
}

async function runStatusAction(session: FeeTrackSession, body: ActionBody, action: 'mark_break' | 'mark_discontinued') {
  const result = await FeeOperationsService.runLedgerAction(session, {
    action,
    skfId: String(body.id || body.skfId || ''),
    month: monthName(body.month),
    year: targetYear(body.year),
    feeType: 'monthly',
    reason: action === 'mark_break' ? 'Marked break from FeeTrack.' : 'Marked discontinued from FeeTrack.',
  })
  return { success: true, data: result }
}

async function resumeStudent(session: FeeTrackSession, body: ActionBody) {
  const result = await FeeOperationsService.runLedgerAction(session, {
    action: 'resume_billing',
    skfId: String(body.id || body.skfId || ''),
    month: monthName(body.month),
    year: targetYear(body.year),
    monthlyFee: hasAmount(body.monthlyFee) ? readAmount(body.monthlyFee) : undefined,
    reason: String(body.reason || 'Student resumed from FeeTrack.'),
  })
  return { success: true, data: result }
}

async function markNonRecurringPaid(session: FeeTrackSession, body: ActionBody) {
  const feeType = String(body.feeType || '').toLowerCase() === 'dress' ? 'dress' : 'admission'
  const result = await FeeOperationsService.runLedgerAction(session, {
    action: 'mark_paid',
    skfId: String(body.studentId || body.id || body.skfId || ''),
    month: monthName(body.month),
    year: targetYear(body.year),
    feeType,
    paymentMethod: 'manual',
    paymentReference: 'FeeTrack',
  })
  return { success: true, data: result }
}

function normalizeReminderTarget(target: Record<string, unknown>, fallback: ActionBody) {
  const feeRecordIds = [
    ...stringArray(target.feeRecordIds),
    ...stringArray(target.selectedFeeRecordIds),
    ...stringArray(target.pendingFeeIds),
  ]
  const singleFeeRecordId = String(target.feeRecordId || '').trim()
  const hasSelectedRows = feeRecordIds.length > 0 || Boolean(singleFeeRecordId)

  return {
    skfId: String(target.skfId || target.studentId || target.id || fallback.skfId || fallback.studentId || fallback.id || ''),
    feeRecordId: singleFeeRecordId || undefined,
    feeRecordIds: feeRecordIds.length ? feeRecordIds : undefined,
    feeType: target.feeType ? String(target.feeType) : fallback.feeType ? String(fallback.feeType) : undefined,
    month: target.month
      ? monthName(target.month)
      : !hasSelectedRows
        ? monthName(fallback.month)
        : undefined,
    year: target.year
      ? targetYear(target.year)
      : !hasSelectedRows
        ? targetYear(fallback.year)
        : undefined,
    amount: hasAmount(target.amount) ? readAmount(target.amount) : undefined,
  }
}

async function sendWhatsappReminder(session: FeeTrackSession, body: ActionBody, previewOnly = false) {
  const rawTargets = Array.isArray(body.targets)
    ? body.targets as Array<Record<string, unknown>>
    : [body]
  const targets = rawTargets.map((target) => normalizeReminderTarget(target, body))
  const parsed = feeReminderSendSchema.parse({
    channel: body.channel || 'whatsapp',
    templateKey: body.templateKey || (targets.some((target) => (target.feeRecordIds || []).length > 1) ? 'selected_pending_fees' : 'fee_due'),
    targets,
    note: body.note ? String(body.note) : undefined,
    markFollowup: previewOnly ? false : body.markFollowup === undefined ? true : Boolean(body.markFollowup),
    previewOnly,
  })
  const result = await FeeOperationsService.sendReminders(session, parsed)

  return {
    success: true,
    data: result,
    messages: result.results
      .filter((entry: Record<string, unknown>) => entry.success)
      .map((entry: Record<string, unknown>) => ({
        studentId: String(entry.skfId || ''),
        status: String(entry.status || ''),
        message: String(entry.message || ''),
        messageUrl: String(entry.messageUrl || ''),
        selectedFees: entry.selectedFees || [],
      })),
  }
}

async function getBranchCounts(session: FeeTrackSession) {
  const [herohalli, mp] = await Promise.all([
    FeeOperationsService.getStudents(session, {
      year: new Date().getFullYear(),
      month: MONTHS[new Date().getMonth()],
      city: 'bangalore',
      branch: 'Herohalli',
    }),
    FeeOperationsService.getStudents(session, {
      year: new Date().getFullYear(),
      month: MONTHS[new Date().getMonth()],
      city: 'bangalore',
      branch: 'M P Sports Club',
    }),
  ])

  return {
    success: true,
    data: {
      herohalli: herohalli.summary.students,
      mp: mp.summary.students,
    },
  }
}

async function getPaymentVerifications(session: FeeTrackSession, body: ActionBody) {
  const branch = normalizeBranch(body.branch, { allowOverall: true })
  const data = await FeeOperationsService.getPaymentProofs(session, {
    city: 'bangalore',
    branch,
    status: 'pending_verification',
    limit: 100,
  })

  return {
    success: true,
    data: {
      verifications: ((data.proofs as Record<string, unknown>[]) || []).map(mapPaymentProof),
      pagination: data.pagination,
    },
  }
}

async function approvePaymentVerification(session: FeeTrackSession, body: ActionBody) {
  const proofId = String(body.proofId || '').trim()
  if (!proofId) throw new ValidationError({ proofId: ['Payment proof ID is required.'] })
  const result = await FeeOperationsService.approvePaymentProof(session, proofId, String(body.note || ''))
  return { success: true, data: result }
}

async function rejectPaymentVerification(session: FeeTrackSession, body: ActionBody) {
  const proofId = String(body.proofId || '').trim()
  if (!proofId) throw new ValidationError({ proofId: ['Payment proof ID is required.'] })
  const result = await FeeOperationsService.rejectPaymentProof(session, proofId, String(body.note || ''))
  return { success: true, data: result }
}

async function getCredits(session: FeeTrackSession, body: ActionBody) {
  const branch = normalizeBranch(body.branch)
  const data = await FeeOperationsService.getCredits(session, {
    city: 'bangalore',
    branch,
    status: body.status ? String(body.status) as 'available' | 'used' | 'cancelled' : undefined,
  })
  const credits = data.credits.map(mapCredit)
  return {
    success: true,
    data: {
      credits,
      totalUnused: credits.filter((credit) => !credit.isUsed).reduce((sum, credit) => sum + credit.amount, 0),
      totalUsed: credits.filter((credit) => credit.isUsed).reduce((sum, credit) => sum + credit.amount, 0),
    },
  }
}

async function getStudentCredits(session: FeeTrackSession, body: ActionBody) {
  const data = await FeeOperationsService.getCredits(session, {
    city: 'bangalore',
    branch: normalizeBranch(body.branch),
    status: 'available',
  })
  const skfId = normaliseSkfId(String(body.studentId || body.id || body.skfId || ''))
  const credits = data.credits
    .filter((credit: Record<string, unknown>) => normaliseSkfId(String(credit.skf_id || '')) === skfId)
    .map((credit: Record<string, unknown>) => ({
      id: String(credit.id || ''),
      amount: readAmount(credit.amount),
      reason: String(credit.reason || ''),
      dateEarned: compactDate(credit.earned_at || credit.created_at),
    }))

  return {
    success: true,
    data: {
      credits,
      totalAvailable: credits.reduce((sum, credit) => sum + credit.amount, 0),
    },
  }
}

async function addReferralCredit(session: FeeTrackSession, body: ActionBody) {
  const created = await FeeOperationsService.createCredit(session, {
    skfId: String(body.studentId || ''),
    amount: readAmount(body.amount),
    reason: String(body.reason || 'Referral credit'),
    description: String(body.description || ''),
  })

  if (body.usedInMonth !== undefined && body.usedInMonth !== null && body.usedInMonth !== '') {
    await FeeOperationsService.runLedgerAction(session, {
      action: 'apply_credit',
      creditId: String((created as { id?: string }).id || ''),
      skfId: String(body.studentId || ''),
      month: monthName(body.usedInMonth),
      year: targetYear(body.year),
      feeType: 'monthly',
    })
  }

  return { success: true, data: created }
}

async function updateReferralCredit(session: FeeTrackSession, body: ActionBody) {
  const updated = await FeeOperationsService.updateCredit(session, String(body.creditId || ''), {
    amount: body.amount !== undefined ? readAmount(body.amount) : undefined,
    reason: body.reason !== undefined ? String(body.reason) : undefined,
    description: body.description !== undefined ? String(body.description) : undefined,
  })
  return { success: true, data: updated }
}

async function deleteReferralCredit(session: FeeTrackSession, body: ActionBody) {
  const result = await FeeOperationsService.deleteCredit(session, String(body.creditId || ''))
  return { success: true, data: result }
}

async function getDevelopmentFund(session: FeeTrackSession, body: ActionBody) {
  const data = await FeeOperationsService.getDevelopmentFund(session, {
    city: 'bangalore',
    year: targetYear(body.year),
  })
  return { success: true, data: mapDevelopmentFund(data as Record<string, unknown>) }
}

async function addDevelopmentExpense(session: FeeTrackSession, body: ActionBody) {
  const result = await FeeOperationsService.createDevelopmentExpense(session, {
    month: monthName(body.month),
    year: targetYear(body.year),
    title: String(body.title || ''),
    description: String(body.description || ''),
    scope: normalizeScope(body.scope),
    amount: readAmount(body.amount),
  })
  return { success: true, data: mapExpense(result as Record<string, unknown>) }
}

async function deleteDevelopmentExpense(session: FeeTrackSession, body: ActionBody) {
  const result = await FeeOperationsService.deleteDevelopmentExpense(session, String(body.expenseId || ''))
  return { success: true, data: result }
}

async function addExtraIncome(session: FeeTrackSession, body: ActionBody) {
  const result = await FeeOperationsService.createExtraIncome(session, {
    month: monthName(body.month),
    year: targetYear(body.year),
    title: String(body.title || ''),
    description: String(body.description || ''),
    scope: normalizeScope(body.scope),
    amount: readAmount(body.amount),
  })
  return { success: true, data: mapExtraIncome(result as Record<string, unknown>) }
}

async function deleteExtraIncome(session: FeeTrackSession, body: ActionBody) {
  const result = await FeeOperationsService.deleteExtraIncome(session, String(body.incomeId || ''))
  return { success: true, data: result }
}

async function addRemoval(session: FeeTrackSession, body: ActionBody) {
  const result = await FeeOperationsService.createRemoval(session, {
    month: monthName(body.month),
    year: targetYear(body.year),
    title: String(body.title || ''),
    description: String(body.description || ''),
    scope: normalizeScope(body.scope),
    amount: readAmount(body.amount),
  })
  return { success: true, data: mapRemoval(result as Record<string, unknown>) }
}

async function deleteRemoval(session: FeeTrackSession, body: ActionBody) {
  const result = await FeeOperationsService.deleteRemoval(session, String(body.removalId || ''))
  return { success: true, data: result }
}

function mapExtraIncome(row: Record<string, unknown>) {
  return {
    id: String(row.id || row.income_code || ''),
    month: monthIndex(row.month),
    year: String(row.year || new Date().getFullYear()),
    title: String(row.title || ''),
    description: String(row.description || ''),
    scope: feeTrackScope(row.scope),
    amount: readAmount(row.amount),
    dateAdded: compactDate(row.created_at),
  }
}

function mapRemoval(row: Record<string, unknown>) {
  return {
    id: String(row.id || row.removal_code || ''),
    month: monthIndex(row.month),
    year: String(row.year || new Date().getFullYear()),
    title: String(row.title || ''),
    description: String(row.description || ''),
    scope: feeTrackScope(row.scope),
    amount: readAmount(row.amount),
    dateAdded: compactDate(row.created_at),
  }
}

function financeFormulae() {
  return {
    expected: 'Active monthly fee students only. Break and discontinued students are excluded.',
    collected: 'Verified monthly fees marked paid for the selected month.',
    monthlyFeeCash: 'Monthly fees collected minus referral credits applied.',
    grossIncome: 'Monthly fee cash + admission collected + dress profit + extra income + event income.',
    developmentFundContribution: '30% of monthly fee cash only. Admission, dress, extra income, and event income are excluded.',
    developmentFundBalance: 'Total development fund contributions minus development expenses.',
    availableBalance: 'Opening reserve + gross income - development expenses - event expenses - custom removals through the selected month.',
    pending: 'Monthly fees still due or rejected. Submitted proofs awaiting verification stay in the action inbox until approved.',
  }
}

function ledgerCategoryLabel(feeType: string) {
  if (feeType === 'monthly') return 'Monthly Fee'
  if (feeType === 'admission') return 'Admission'
  if (feeType === 'dress') return 'Dress'
  if (feeType === 'belt_exam') return 'Belt Exam'
  if (feeType === 'tournament') return 'Tournament'
  if (feeType === 'event') return 'Event'
  if (feeType === 'other') return 'Other Due'
  if (feeType === 'credit_adjustment') return 'Referral Credit'
  return 'Fee'
}

function ledgerFormulaKey(feeType: string) {
  if (feeType === 'monthly') return 'monthlyFeeCash'
  if (feeType === 'admission') return 'admissionCollected'
  if (feeType === 'dress') return 'dressProfit'
  if (['belt_exam', 'tournament', 'event', 'other'].includes(feeType)) return 'eventIncome'
  if (feeType === 'credit_adjustment') return 'creditsApplied'
  return 'grossIncome'
}

function isReminderPayableStatus(status: unknown) {
  return ['due', 'overdue', 'rejected'].includes(String(status || '').toLowerCase())
}

function pendingFeeLabel(input: { feeType: string; sourceLabel?: string | null; month?: string; year?: number }) {
  const base = input.sourceLabel || ledgerCategoryLabel(input.feeType)
  const period = input.month && input.year ? ` - ${input.month} ${input.year}` : ''
  return `${base}${period}`
}

async function getFinanceCommandCenter(session: FeeTrackSession, body: ActionBody) {
  const branch = normalizeBranch(body.branch, { allowOverall: true })
  const month = monthName(body.month)
  const selectedMonth = monthIndex(month)
  const year = targetYear(body.year)

  const [dashboard, finance, ledger] = await Promise.all([
    FeeOperationsService.getDashboard(session, {
      year,
      month,
      city: 'bangalore',
      branch,
    }),
    FeeOperationsService.getFinance(session, {
      year,
      month,
      city: 'bangalore',
      branch,
    }),
    FeeOperationsService.getLedger(session, {
      year,
      month,
      city: 'bangalore',
      branch,
      feeType: 'all',
    }),
  ])

  const financeRows = (finance.monthlyBreakdown as Record<string, unknown>[]) || []
  const monthRow = financeRows.find((row) => row.month === month) || {}
  const bankPosition = (finance.bankPosition as Record<string, unknown>) || {}
  const monthlyFeeCash = readAmount(monthRow.monthlyCash)
  const admissionCollected = readAmount(monthRow.admissionCollected)
  const dressProfit = readSignedAmount(monthRow.dressProfit)
  const extraIncome = readAmount(monthRow.extraIncome)
  const eventIncome = readAmount(monthRow.eventIncome)
  const eventExpenses = readAmount(monthRow.eventExpenses)
  const eventSurplus = readSignedAmount(monthRow.eventSurplus)
  const eventDeposits = readAmount(monthRow.eventDeposits)
  const grossIncome = hasAmount(monthRow.grossIncome)
    ? readSignedAmount(monthRow.grossIncome)
    : monthlyFeeCash + admissionCollected + dressProfit + extraIncome + eventIncome
  const developmentExpenses = readAmount(monthRow.developmentExpenses)
  const developmentFundContribution = readAmount(monthRow.developmentAllocation)
  const developmentFundBalance = readSignedAmount(bankPosition.developmentFundBalance)
  const availableBalance = readSignedAmount(bankPosition.actualBankBalance)
  const customRemovals = readAmount(monthRow.customRemovals) || 0
  const creditsApplied = readAmount(monthRow.creditsApplied)
  const expected = readAmount(dashboard.summary.expected)
  const collected = readAmount(dashboard.summary.collected)
  const pending = readAmount(dashboard.summary.pending)
  const warnings: { level: 'info' | 'warning' | 'danger'; message: string }[] = []

  if (pending > 0) {
    warnings.push({
      level: 'warning',
      message: `${dashboard.summary.pendingCount} student${dashboard.summary.pendingCount === 1 ? '' : 's'} still pending for ${month}.`,
    })
  }

  if (developmentFundBalance < 0) {
    warnings.push({
      level: 'danger',
      message: 'Development fund balance is negative after recorded expenses.',
    })
  }

  if (Math.abs(grossIncome - (monthlyFeeCash + admissionCollected + dressProfit + extraIncome + eventIncome)) > 1) {
    warnings.push({
      level: 'warning',
      message: 'Income formula mismatch detected. Review monthly fee, admission, dress, extra income, and event ledger rows.',
    })
  }

  const feeLedgerRows = ((ledger.entries as Record<string, unknown>[]) || []).map((entry) => {
    const feeType = String(entry.feeType || 'monthly')
    const amount = readAmount(entry.amount)
    const isCredit = feeType === 'credit_adjustment'
    const paid = String(entry.status || '') === 'paid'
    return {
      id: String(entry.id || entry.key || ''),
      date: compactDate(entry.paidDate) || `${year}-${String(selectedMonth + 1).padStart(2, '0')}-01`,
      month: monthIndex(entry.month),
      year: readAmount(entry.year) || year,
      branch: feeTrackScope(entry.branch),
      label: isCredit
        ? `Credit applied - ${entry.athleteName || 'SKF Athlete'}`
        : `${entry.sourceLabel || ledgerCategoryLabel(feeType)} - ${entry.athleteName || 'SKF Athlete'}`,
      category: feeType,
      type: isCredit ? 'credit' : paid ? 'income' : 'pending',
      amount: isCredit ? -amount : amount,
      studentId: String(entry.skfId || ''),
      studentName: String(entry.athleteName || ''),
      receiptId: String(entry.receiptId || ''),
      status: String(entry.status || ''),
      formulaKey: !paid && !isCredit ? 'pending' : ledgerFormulaKey(feeType),
    }
  })

  const expenseLedgerRows = (((finance.expenses as Record<string, unknown>[]) || [])
    .filter((expense) => monthName(expense.month) === month)
    .map((expense) => ({
      id: String(expense.id || expense.expense_code || ''),
      date: compactDate(expense.created_at),
      month: selectedMonth,
      year,
      branch: feeTrackScope(expense.scope),
      label: String(expense.title || expense.description || 'Development expense'),
      category: 'development_expense',
      type: 'expense',
      amount: -readAmount(expense.amount),
      studentId: '',
      studentName: '',
      receiptId: '',
      status: 'recorded',
      formulaKey: 'developmentExpenses',
    })))

  const extraIncomeLedgerRows = (((finance.extraIncomes as Record<string, unknown>[]) || [])
    .filter((income) => monthName(income.month) === month)
    .map((income) => ({
      id: String(income.id || income.income_code || ''),
      date: compactDate(income.created_at),
      month: selectedMonth,
      year,
      branch: feeTrackScope(income.scope),
      label: String(income.title || income.description || 'Extra income'),
      category: 'extra_income',
      type: 'income',
      amount: readAmount(income.amount),
      studentId: '',
      studentName: '',
      receiptId: '',
      status: 'recorded',
      formulaKey: 'extraIncome',
    })))

  const eventExpenseLedgerRows = (((finance.eventExpenses as Record<string, unknown>[]) || [])
    .filter((expense) => monthNameFromDateValue(expense.expense_date) === month)
    .map((expense) => ({
      id: String(expense.id || ''),
      date: compactDate(expense.expense_date || expense.created_at),
      month: selectedMonth,
      year,
      branch: feeTrackScope(expense.branch_scope),
      label: String(expense.title || 'Event expense'),
      category: 'event_expense',
      type: 'expense',
      amount: -readAmount(expense.amount),
      studentId: '',
      studentName: '',
      receiptId: '',
      status: 'recorded',
      formulaKey: 'eventExpenses',
    })))

  const eventDepositLedgerRows = (((finance.eventDeposits as Record<string, unknown>[]) || [])
    .filter((deposit) => monthNameFromDateValue(deposit.deposit_date) === month)
    .map((deposit) => ({
      id: String(deposit.id || ''),
      date: compactDate(deposit.deposit_date || deposit.created_at),
      month: selectedMonth,
      year,
      branch: feeTrackScope(deposit.branch_scope),
      label: String(deposit.reference || deposit.notes || 'Event bank deposit'),
      category: 'event_deposit',
      type: 'income',
      amount: readAmount(deposit.amount),
      studentId: '',
      studentName: '',
      receiptId: '',
      status: 'deposited',
      formulaKey: 'eventDeposits',
    })))

  const removalLedgerRows = (((finance.removals as Record<string, unknown>[]) || [])
    .filter((removal) => monthName(removal.month) === month)
    .map((removal) => ({
      id: String(removal.id || removal.removal_code || ''),
      date: compactDate(removal.created_at),
      month: selectedMonth,
      year,
      branch: feeTrackScope(removal.scope),
      label: String(removal.title || removal.description || 'Custom removal'),
      category: 'custom_removal',
      type: 'expense',
      amount: -readAmount(removal.amount),
      studentId: '',
      studentName: '',
      receiptId: '',
      status: 'recorded',
      formulaKey: 'customRemovals',
    })))

  return {
    success: true,
    data: {
      month: selectedMonth,
      year,
      periodLabel: `${month} ${year}`,
      branch: branch ? feeTrackScope(branch) : 'Overall',
      summary: {
        activeStudents: readAmount(dashboard.summary.students),
        paidStudents: readAmount(dashboard.summary.paidCount),
        pendingStudents: readAmount(dashboard.summary.pendingCount),
        expected,
        collected,
        pending,
        creditsApplied,
        monthlyFeeCash,
        admissionCollected,
        dressProfit,
        extraIncome,
        eventIncome,
        grossIncome,
        developmentFundContribution,
        developmentExpenses,
        eventExpenses,
        customRemovals,
        eventSurplus,
        eventDeposits,
        developmentFundBalance,
        availableBalance,
        collectionRate: readAmount(dashboard.summary.collectionRate),
      },
      incomeBreakdown: [
        {
          key: 'monthlyFeeCash',
          label: 'Monthly fee cash',
          amount: monthlyFeeCash,
          formula: financeFormulae().monthlyFeeCash,
        },
        {
          key: 'admissionCollected',
          label: 'Admission collected',
          amount: admissionCollected,
          formula: 'Admission fee rows marked paid.',
        },
        {
          key: 'dressProfit',
          label: 'Dress profit',
          amount: dressProfit,
          formula: 'Dress fee collected minus dress cost.',
        },
        {
          key: 'extraIncome',
          label: 'Extra income',
          amount: extraIncome,
          formula: 'Additional revenue like summer camps, events, etc.',
        },
        {
          key: 'eventIncome',
          label: 'Event income',
          amount: eventIncome,
          formula: 'Belt exam, tournament, and event fee rows marked paid.',
        },
      ],
      expenseBreakdown: [
        {
          key: 'developmentExpenses',
          label: 'Development expenses',
          amount: developmentExpenses,
          formula: 'Recorded development fund expenses for the selected month.',
        },
        {
          key: 'customRemovals',
          label: 'Custom removals',
          amount: customRemovals,
          formula: 'Recorded custom removals (withdrawals from master ledger) for the selected month.',
        },
        {
          key: 'eventExpenses',
          label: 'Event expenses',
          amount: eventExpenses,
          formula: 'Recorded expenses linked to paid events.',
        },
      ],
      cashFlowByMonth: financeRows.map((row) => {
        const income = hasAmount(row.grossIncome)
          ? readSignedAmount(row.grossIncome)
          : readAmount(row.monthlyCash) + readAmount(row.admissionCollected) + readSignedAmount(row.dressProfit) + readAmount(row.extraIncome) + readAmount(row.eventIncome)
        return {
          month: monthIndex(row.month),
          year: readAmount(row.year) || year,
          income,
          developmentFundContribution: readAmount(row.developmentAllocation),
          expenses: readAmount(row.developmentExpenses) + readAmount(row.eventExpenses) + readAmount(row.customRemovals),
          net: readSignedAmount(row.bankMovement),
          balance: readSignedAmount(row.cumulativeBank),
          developmentFundBalance: readSignedAmount(row.cumulativeDevelopmentFund),
        }
      }),
      ledgerRows: [...feeLedgerRows, ...expenseLedgerRows, ...extraIncomeLedgerRows, ...eventExpenseLedgerRows, ...eventDepositLedgerRows, ...removalLedgerRows].sort((a, b) =>
        b.date.localeCompare(a.date) || a.label.localeCompare(b.label)
      ),
      warnings,
      formulas: financeFormulae(),
    },
  }
}

async function getFinancialSummary(session: FeeTrackSession, body: ActionBody) {
  const branch = normalizeBranch(body.branch, { allowOverall: true })
  const month = monthName(body.month)
  const year = targetYear(body.year)
  const [dashboard, finance, ledger] = await Promise.all([
    FeeOperationsService.getDashboard(session, {
      year,
      month,
      city: 'bangalore',
      branch,
    }),
    FeeOperationsService.getFinance(session, {
      year,
      month,
      city: 'bangalore',
      branch,
    }),
    FeeOperationsService.getLedger(session, {
      year,
      month,
      city: 'bangalore',
      branch,
      feeType: 'all',
    }),
  ])
  const monthRow = finance.monthlyBreakdown.find((row: Record<string, unknown>) => row.month === month) || {} as Record<string, unknown>
  const isOverall = !branch
  const reserveAmount = isOverall ? readAmount(finance.bankPosition?.reserveAmount) : 0
  const actualBankBalance = readSignedAmount(finance.bankPosition?.actualBankBalance)
  const creditDetails = ledger.entries
    .filter((entry: Record<string, unknown>) => entry.feeType === 'credit_adjustment' && entry.status === 'paid')
    .map((entry: Record<string, unknown>) => ({
      studentName: String(entry.athleteName || ''),
      amount: readAmount(entry.amount),
      reason: 'Fee credit',
      description: String(entry.notes || ''),
      date: compactDate(entry.paidDate),
    }))

  return {
    success: true,
    data: {
      month: monthIndex(month),
      branch: branch || 'Overall',
      activeStudents: dashboard.summary.students,
      paidStudents: dashboard.summary.paidCount,
      pendingStudents: dashboard.summary.pendingCount,
      expected: dashboard.summary.expected,
      collected: dashboard.summary.collected,
      pending: dashboard.summary.pending,
      creditsApplied: readAmount(monthRow.creditsApplied),
      creditDetails,
      actualReceived: readSignedAmount(monthRow.bankMovement),
      actualBankBalance,
      devFundAllocation: readAmount(monthRow.developmentAllocation),
      devFundSpent: readAmount(monthRow.developmentExpenses),
      devFundBalance: readSignedAmount(finance.bankPosition?.developmentFundBalance),
      totalContributions: readAmount(finance.bankPosition?.developmentAllocation),
      availableBalance: readSignedAmount(finance.bankPosition?.developmentFundBalance),
      yearlyBreakdown: finance.monthlyBreakdown.map((row: Record<string, unknown>) => ({
        month: String(row.month || '').slice(0, 3),
        revenue: hasAmount(row.grossIncome)
          ? readSignedAmount(row.grossIncome)
          : readAmount(row.monthlyCash) + readAmount(row.admissionCollected) + readSignedAmount(row.dressProfit) + readAmount(row.extraIncome) + readAmount(row.eventIncome),
        devFund: readAmount(row.developmentAllocation),
        expenses: readAmount(row.developmentExpenses) + readAmount(row.eventExpenses) + readAmount(row.customRemovals),
        net: readSignedAmount(row.bankMovement),
        cumulativeRevenue: readSignedAmount(row.cumulativeBank),
        cumulativeBank: readSignedAmount(row.cumulativeBank),
      })),
      admissionCollected: readAmount(monthRow.admissionCollected),
      dressProfit: readSignedAmount(monthRow.dressProfit),
      grossIncome: hasAmount(monthRow.grossIncome)
        ? readSignedAmount(monthRow.grossIncome)
        : readAmount(monthRow.monthlyCash) + readAmount(monthRow.admissionCollected) + readSignedAmount(monthRow.dressProfit) + readAmount(monthRow.extraIncome) + readAmount(monthRow.eventIncome),
      eventIncome: readAmount(monthRow.eventIncome),
      eventExpenses: readAmount(monthRow.eventExpenses),
      eventSurplus: readSignedAmount(monthRow.eventSurplus),
      eventDeposits: readAmount(monthRow.eventDeposits),
      reserveUsed: reserveAmount,
    },
  }
}

async function getAdmissionDashboard(_session: FeeTrackSession, body: ActionBody) {
  const query = admissionListQuerySchema.parse({
    status: body.status || 'pending',
    branchSlug: body.branchSlug || '',
    search: body.search || '',
    limit: body.limit || 100,
  })
  const [applications, promoCodes, branchSettings] = await Promise.all([
    AdmissionService.listApplications(query),
    AdmissionService.listPromos(),
    AdmissionService.listBranchSettings(),
  ])

  return {
    success: true,
    data: {
      applications,
      promoCodes,
      branchSettings,
    },
  }
}

async function getAdmissionApplications(_session: FeeTrackSession, body: ActionBody) {
  const query = admissionListQuerySchema.parse({
    status: body.status || 'pending',
    branchSlug: body.branchSlug || '',
    search: body.search || '',
    limit: body.limit || 100,
  })
  const applications = await AdmissionService.listApplications(query)
  return { success: true, data: { applications } }
}

async function getAdmissionApplication(_session: FeeTrackSession, body: ActionBody) {
  const applicationId = String(body.applicationId || body.id || '').trim()
  if (!applicationId) throw new ValidationError({ applicationId: ['Admission application ID is required.'] })
  const application = await AdmissionService.getApplication(applicationId)
  return { success: true, data: { application } }
}

async function rejectAdmissionApplication(session: FeeTrackSession, body: ActionBody) {
  const parsed = admissionRejectSchema.parse({
    applicationId: body.applicationId || body.id,
    reason: body.reason,
  })
  const application = await AdmissionService.rejectApplication(session, parsed.applicationId, parsed.reason)
  return { success: true, data: { application } }
}

async function upsertAdmissionPromoCode(session: FeeTrackSession, body: ActionBody) {
  const source = (body.promoCode && typeof body.promoCode === 'object')
    ? body.promoCode as Record<string, unknown>
    : body
  const promoCode = await AdmissionService.upsertPromo(session, admissionPromoCodeSchema.parse(source))
  return { success: true, data: { promoCode } }
}

async function updateAdmissionBranchSettings(session: FeeTrackSession, body: ActionBody) {
  const source = (body.settings && typeof body.settings === 'object')
    ? body.settings as Record<string, unknown>
    : body
  const settings = await AdmissionService.updateBranchSettings(
    session,
    admissionBranchSettingsSchema.parse(source)
  )
  return { success: true, data: { settings } }
}

async function getFeeTrackEvent(session: FeeTrackSession, eventId: unknown) {
  const id = String(eventId || '').trim()
  if (!id) throw new ValidationError({ eventId: ['Event ID is required.'] })

  const event = await getEventByIdAdminLive(id) as FeeTrackEvent | null
  if (!event) throw new NotFoundError('Event')
  assertBranchAccess(session, event.hostingBranch)
  return event
}

async function createEventFromFeeTrack(session: FeeTrackSession, body: ActionBody) {
  assertEventWrite(session)
  const source = (body.event && typeof body.event === 'object')
    ? body.event as Record<string, unknown>
    : body
  const hostingBranch = source.hostingBranch !== undefined || source.branch !== undefined
    ? normalizeBranch(source.hostingBranch ?? source.branch, { allowOverall: true })
    : defaultEventBranch(session)

  assertBranchAccess(session, hostingBranch)

  const eventType = slugify(source.type || 'seminar')
  const eventName = String(source.name || '').trim()
  if (!eventName) throw new ValidationError({ name: ['Event name is required.'] })
  const isPublished = Boolean(source.isPublished)
  const status = String(source.status || 'upcoming').trim() || 'upcoming'

  const payload = eventType === 'tournament'
    ? await withLegacyApiError(() => ({
        ...validateTournamentPayload({
          name: eventName,
          shortName: String(source.shortName || eventName).trim(),
          slug: slugify(source.slug || eventName),
          level: slugify(source.level || 'district') || 'district',
          status: isPublished && status === 'draft' ? 'upcoming' : status,
          date: source.date,
          endDate: source.endDate,
          venue: source.venue || hostingBranch || 'SKF Karate',
          city: source.city || 'Bengaluru',
          state: source.state || 'Karnataka',
          description: source.description || `${eventName} tournament`,
          coverImageUrl: source.coverImageUrl,
          totalParticipants: Number(source.totalParticipants || 1),
          skfParticipants: Number(source.skfParticipants || 0),
          affiliatedBody: source.affiliatedBody,
          isPublished,
          isFeatured: Boolean(source.isFeatured),
          showInJourney: Boolean(source.showInJourney),
          participants: [],
          results: [],
          winners: [],
        }),
        type: 'tournament',
      }))
    : await withLegacyApiError(() => validateEventPayload({
        name: eventName,
        shortName: String(source.shortName || eventName).trim(),
        slug: slugify(source.slug || eventName),
        type: eventType || 'seminar',
        status: isPublished && status === 'draft' ? 'upcoming' : status,
        date: source.date,
        endDate: source.endDate,
        venue: source.venue,
        city: source.city,
        state: source.state || 'Karnataka',
        description: source.description,
        coverImageUrl: source.coverImageUrl,
        affiliatedBody: source.affiliatedBody,
        hostingBranch,
        isPublished,
        isFeatured: Boolean(source.isFeatured),
        isResultsPublished: false,
        showInJourney: Boolean(source.showInJourney),
        participants: [],
        results: [],
      }))

  const event = await withLegacyApiError(() => createEventRecordLive(payload as Partial<TournamentRecord>)) as FeeTrackEvent
  if (event.type === 'tournament') {
    revalidateTournamentSitePaths(event)
  } else {
    revalidateEventSitePaths(event)
  }
  return { success: true, data: { event: mapEventForFeeTrack(event) } }
}

async function updateEventFromFeeTrack(session: FeeTrackSession, body: ActionBody) {
  assertEventWrite(session)
  const source = (body.event && typeof body.event === 'object')
    ? body.event as Record<string, unknown>
    : body
  const event = await getFeeTrackEvent(session, source.id || body.eventId)

  const nextType = source.type === undefined
    ? String(event.type || 'seminar')
    : slugify(source.type || 'seminar')
  if (event.type !== nextType && (event.type === 'tournament' || nextType === 'tournament')) {
    throw new ValidationError({
      type: ['Create a new record when changing an event to or from a tournament.'],
    })
  }

  const hostingBranch = source.hostingBranch !== undefined || source.branch !== undefined
    ? normalizeBranch(source.hostingBranch ?? source.branch, { allowOverall: true })
    : String(event.hostingBranch || '')
  assertBranchAccess(session, hostingBranch)

  const name = String(source.name ?? event.name ?? '').trim()
  if (!name) throw new ValidationError({ name: ['Event name is required.'] })

  const isPublished = source.isPublished === undefined ? Boolean(event.isPublished) : Boolean(source.isPublished)
  const status = String(source.status ?? event.status ?? 'upcoming').trim() || 'upcoming'
  const payload = event.type === 'tournament'
    ? await withLegacyApiError(() => ({
        ...validateTournamentPayload({
          ...event,
          name,
          shortName: String(source.shortName ?? event.shortName ?? name).trim() || name,
          slug: source.slug === undefined ? String(event.slug || slugify(name)) : slugify(source.slug || name),
          level: slugify(source.level ?? event.level ?? 'district') || 'district',
          status: isPublished && status === 'draft' ? 'upcoming' : status,
          date: source.date ?? event.date,
          endDate: source.endDate ?? event.endDate,
          venue: source.venue ?? event.venue ?? 'SKF Karate',
          city: source.city ?? event.city ?? 'Bengaluru',
          state: source.state ?? event.state ?? 'Karnataka',
          description: source.description ?? event.description ?? `${name} tournament`,
          coverImageUrl: source.coverImageUrl ?? event.coverImageUrl,
          totalParticipants: Math.max(
            1,
            Number(source.totalParticipants ?? event.totalParticipants ?? (event.participants || []).length ?? 1)
          ),
          skfParticipants: Number(source.skfParticipants ?? event.skfParticipants ?? (event.participants || []).length ?? 0),
          affiliatedBody: source.affiliatedBody ?? event.affiliatedBody,
          isPublished,
          isFeatured: source.isFeatured === undefined ? Boolean(event.isFeatured) : Boolean(source.isFeatured),
          showInJourney: source.showInJourney === undefined ? Boolean(event.showInJourney) : Boolean(source.showInJourney),
          participants: event.participants || [],
          results: Array.isArray(event.results) ? event.results : [],
          winners: Array.isArray(event.winners) ? event.winners : [],
        }),
        type: 'tournament',
      }))
    : await withLegacyApiError(() => validateEventPayload({
        ...event,
        name,
        shortName: String(source.shortName ?? event.shortName ?? name).trim() || name,
        slug: source.slug === undefined ? String(event.slug || slugify(name)) : slugify(source.slug || name),
        type: nextType || 'seminar',
        status: isPublished && status === 'draft' ? 'upcoming' : status,
        date: source.date ?? event.date,
        endDate: source.endDate ?? event.endDate,
        venue: source.venue ?? event.venue,
        city: source.city ?? event.city,
        state: source.state ?? event.state ?? 'Karnataka',
        description: source.description ?? event.description,
        coverImageUrl: source.coverImageUrl ?? event.coverImageUrl,
        affiliatedBody: source.affiliatedBody ?? event.affiliatedBody,
        hostingBranch,
        isPublished,
        isFeatured: source.isFeatured === undefined ? Boolean(event.isFeatured) : Boolean(source.isFeatured),
        isResultsPublished: Boolean(event.isResultsPublished),
        showInJourney: source.showInJourney === undefined ? Boolean(event.showInJourney) : Boolean(source.showInJourney),
        participants: event.participants || [],
        results: Array.isArray(event.results) ? event.results : [],
      }))

  const updated = await withLegacyApiError(() => updateEventRecordLive(event.id, payload as Partial<TournamentRecord>)) as FeeTrackEvent | null
  if (!updated) throw new NotFoundError('Event')

  if (updated.type === 'tournament') {
    revalidateTournamentSitePaths(updated)
  } else {
    revalidateEventSitePaths(event)
    revalidateEventSitePaths(updated)
  }
  return { success: true, data: { event: mapEventForFeeTrack(updated) } }
}

async function assertEventCanBeDeletedFromFeeTrack(session: FeeTrackSession, event: FeeTrackEvent) {
  const data = await EventFeesService.list(session, {
    year: targetYear(event.date ? new Date(`${String(event.date).slice(0, 10)}T00:00:00.000Z`).getUTCFullYear() : undefined),
    branch: '',
  })
  const linked = data.events.find((item) => item.event.id === event.id)
  if (!linked) return

  const hasFinancialActivity = Boolean(linked.config) ||
    linked.collection.chargedCount > 0 ||
    linked.collection.expected > 0 ||
    linked.collection.collected > 0 ||
    linked.collection.pending > 0 ||
    linked.expenses.length > 0 ||
    linked.deposits.length > 0

  if (hasFinancialActivity) {
    throw new ValidationError({
      event: ['This event has FeeTrack fees, expenses, deposits, or configuration. Clear the financial activity before deleting the event.'],
    })
  }
}

async function deleteEventFromFeeTrack(session: FeeTrackSession, body: ActionBody) {
  assertEventWrite(session)
  const event = await getFeeTrackEvent(session, body.eventId || body.id)

  await assertEventCanBeDeletedFromFeeTrack(session, event)
  await clearSyncedEventArtifactsFromAthletes(event.id)
  const deleted = await withLegacyApiError(() => deleteEventRecordLive(event.id))
  if (!deleted) throw new NotFoundError('Event')

  if (event.type === 'tournament') {
    revalidateTournamentSitePaths(event)
  } else {
    revalidateEventSitePaths(event)
  }
  for (const skfId of collectParticipantSkfIds(event)) {
    revalidateAthleteSitePaths(skfId)
  }

  return { success: true, data: { eventId: event.id } }
}

async function searchEventAthletes(session: FeeTrackSession, body: ActionBody) {
  const query = String(body.query || body.q || '').trim().toLowerCase()
  if (query.length < 2) {
    return { success: true, data: { athletes: [] } }
  }

  const athletes = (await getAllAthletesLive()) as FeeTrackAthlete[]
  const results = athletes
    .filter((athlete) => String(athlete.status || '').toLowerCase() !== 'inactive')
    .filter((athlete) => canAccessBranch(session, athlete.branchName))
    .filter((athlete) => {
      const haystack = [
        athlete.firstName,
        athlete.lastName,
        athlete.skfId,
        athlete.branchName,
        athlete.currentBelt,
      ].join(' ').toLowerCase()
      return haystack.includes(query)
    })
    .sort((a, b) => nameForAthlete(a).localeCompare(nameForAthlete(b)))
    .slice(0, 50)
    .map(mapAthleteForFeeTrack)

  return { success: true, data: { athletes: results } }
}

async function findAthleteForAssignment(session: FeeTrackSession, source: Record<string, unknown>) {
  const athleteId = String(source.athleteId || source.id || '').trim()
  const skfId = normaliseSkfId(String(source.skfId || ''))
  if (!athleteId && !skfId) {
    throw new ValidationError({ athlete: ['Student ID or SKF ID is required.'] })
  }

  const athletes = (await getAllAthletesLive()) as FeeTrackAthlete[]
  const athlete = athletes.find((entry) => (
    (athleteId && String(entry.id || '') === athleteId) ||
    (skfId && normaliseSkfId(String(entry.skfId || '')) === skfId)
  )) || null

  if (!athlete) throw new NotFoundError('Student')
  if (String(athlete.status || '').toLowerCase() === 'inactive') {
    throw new ValidationError({ athlete: ['Inactive students cannot be assigned to events.'] })
  }
  assertBranchAccess(session, athlete.branchName)

  return athlete
}

async function saveEventParticipants(event: FeeTrackEvent, participants: FeeTrackEventParticipant[]) {
  const payload = await withLegacyApiError(() => (
    event.type === 'tournament'
      ? validateTournamentPayload({ ...event, participants })
      : validateEventPayload({ ...event, participants })
  ))
  const updated = await withLegacyApiError(() => updateEventRecordLive(event.id, payload as Partial<TournamentRecord>)) as FeeTrackEvent | null
  if (!updated) throw new NotFoundError('Event')

  if (updated.type === 'tournament') {
    revalidateTournamentSitePaths(updated)
  } else {
    revalidateEventSitePaths(updated)
  }

  return updated
}

async function assignEventStudent(session: FeeTrackSession, body: ActionBody) {
  assertEventWrite(session)
  const event = await getFeeTrackEvent(session, body.eventId)
  const source = (body.athlete && typeof body.athlete === 'object')
    ? body.athlete as Record<string, unknown>
    : body
  const athlete = await findAthleteForAssignment(session, source)
  const athleteSkfId = normaliseSkfId(String(athlete.skfId || ''))
  const existingParticipants = event.participants || []

  if (existingParticipants.some((participant) => (
    (athlete.id && participant.athleteId === athlete.id) ||
    normaliseSkfId(String(participant.skfId || '')) === athleteSkfId
  ))) {
    throw new ValidationError({ athlete: ['Student is already assigned to this event.'] })
  }

  const nextParticipant = {
    id: `p_${event.id}_${athlete.id || athleteSkfId}`,
    athleteId: String(athlete.id || ''),
    athleteName: nameForAthlete(athlete),
    skfId: athleteSkfId || String(athlete.skfId || ''),
    branchName: String(athlete.branchName || ''),
    belt: String(athlete.currentBelt || ''),
    photoUrl: resolvedProfilePhoto(athlete),
  }
  const updated = await saveEventParticipants(event, [...existingParticipants, nextParticipant])

  // Auto-generate fees for belt exam / grading events so fees appear without extra steps
  if (event.type === 'grading' || event.name?.toLowerCase().includes('examination')) {
    try {
      await EventFeesService.generate(session, { eventId: event.id, overrides: [] })
    } catch {
      // Best-effort; fee generation may fail if no config exists yet
    }
  }

  revalidateAthleteSitePaths(nextParticipant.skfId)
  return { success: true, data: { event: mapEventForFeeTrack(updated) } }
}

async function removeEventStudent(session: FeeTrackSession, body: ActionBody) {
  assertEventWrite(session)
  const event = await getFeeTrackEvent(session, body.eventId)
  const participantId = String(body.participantId || body.id || '').trim()
  const skfId = normaliseSkfId(String(body.skfId || ''))
  if (!participantId && !skfId) {
    throw new ValidationError({ participant: ['Participant ID or SKF ID is required.'] })
  }

  const existingParticipants = event.participants || []
  const removed = existingParticipants.filter((participant) => (
    (participantId && String(participant.id || '') === participantId) ||
    (skfId && normaliseSkfId(String(participant.skfId || '')) === skfId)
  ))
  const nextParticipants = existingParticipants.filter((participant) => !removed.includes(participant))
  const updated = await saveEventParticipants(event, nextParticipants)

  for (const participant of removed) {
    revalidateAthleteSitePaths(String(participant.skfId || ''))
  }

  return { success: true, data: { event: mapEventForFeeTrack(updated) } }
}

async function syncEligibleBeltExamParticipants(session: FeeTrackSession, body: ActionBody) {
  assertEventWrite(session)
  const event = await getFeeTrackEvent(session, body.eventId)
  const eligibility = await EventFeesService.eligibleBeltExamRows(session, {
    eventId: event.id,
  })

  const eligibleSkfIds = new Set(
    eligibility.rows
      .filter((row) => row.status === 'ready' || row.status === 'waived')
      .map((row) => normaliseSkfId(String(row.skfId || '')))
      .filter(Boolean)
  )
  const existingParticipants = event.participants || []
  const existingSkfIds = collectParticipantSkfIds(event)
  const athletes = (await getAllAthletesLive()) as FeeTrackAthlete[]
  const athleteBySkfId = new Map(
    athletes.map((athlete) => [normaliseSkfId(String(athlete.skfId || '')), athlete])
  )

  const nextParticipants = [...existingParticipants]
  const addedSkfIds: string[] = []

  for (const skfId of eligibleSkfIds) {
    if (existingSkfIds.has(skfId)) continue
    const athlete = athleteBySkfId.get(skfId)
    if (!athlete) continue

    nextParticipants.push({
      id: `p_${event.id}_${String(athlete.id || skfId).replace(/[^a-z0-9_-]+/gi, '_')}`,
      athleteId: String(athlete.id || ''),
      athleteName: nameForAthlete(athlete),
      skfId,
      branchName: String(athlete.branchName || ''),
      belt: String(athlete.currentBelt || ''),
      photoUrl: resolvedProfilePhoto(athlete),
    })
    existingSkfIds.add(skfId)
    addedSkfIds.push(skfId)
  }

  let updated = addedSkfIds.length
    ? await saveEventParticipants(event, nextParticipants)
    : event

  if (addedSkfIds.length) {
    try {
      await EventFeesService.generate(session, { eventId: event.id, overrides: [] })
      // Re-fetch event so returned data includes any updates from fee generation
      updated = await getFeeTrackEvent(session, body.eventId)
    } catch {
      // Fee generation is best-effort during participant sync.
      // If fee config isn't set up yet, fees will be generated later via generate_event_fees.
    }
  }

  for (const skfId of addedSkfIds) {
    revalidateAthleteSitePaths(skfId)
  }

  return {
    success: true,
    data: {
      event: mapEventForFeeTrack(updated),
      summary: {
        added: addedSkfIds.length,
        eligible: eligibility.summary.eligible,
        alreadyAssigned: Math.max(0, eligibility.summary.eligible - addedSkfIds.length),
        needsReview: eligibility.summary.needsReview,
        excluded: eligibility.summary.excluded,
        feeRecordsCreated: addedSkfIds.length,
      },
    },
  }
}

function formatTournamentBelt(value: unknown) {
  const text = String(value || '').trim()
  if (!text) return 'White Belt'
  if (/\bbelt\b/i.test(text)) return text
  return `${text.charAt(0).toUpperCase()}${text.slice(1)} Belt`
}

function resultWithParticipantDefaults(
  event: FeeTrackEvent,
  result: FeeTrackEventResult,
  index: number
) {
  const participantId = String(result.participantId || '')
  const skfId = normaliseSkfId(String(result.skfId || ''))
  const participant = (event.participants || []).find((entry) => {
    return (
      (participantId && String(entry.id || '') === participantId) ||
      (skfId && normaliseSkfId(String(entry.skfId || '')) === skfId)
    )
  })

  const resolvedSkfId = normaliseSkfId(String(result.skfId || participant?.skfId || ''))
  const id = String(result.id || `res_${event.id}_${resolvedSkfId || index + 1}`)

  return {
    ...result,
    id,
    participantId: participantId || String(participant?.id || ''),
    athleteId: String(result.athleteId || participant?.athleteId || ''),
    athleteName: String(result.athleteName || participant?.athleteName || resolvedSkfId || 'SKF Athlete'),
    skfId: resolvedSkfId,
    branchName: String(result.branchName || participant?.branchName || 'SKF Karate'),
    belt: String(result.belt || participant?.belt || ''),
    photoUrl: resolvedProfilePhoto({
      skfId: resolvedSkfId,
      photoUrl: String(result.photoUrl || participant?.photoUrl || ''),
    }),
  }
}

function deriveTournamentWinners(results: FeeTrackEventResult[]) {
  const positionMap: Record<string, number> = { gold: 1, silver: 2, bronze: 3 }
  return results
    .filter((result) => ['gold', 'silver', 'bronze'].includes(String(result.medal || result.result || '').toLowerCase()))
    .map((result, index) => {
      const medal = String(result.medal || result.result || 'bronze').toLowerCase()
      return {
        id: String(result.id || `winner_${index + 1}`),
        athleteId: String(result.athleteId || ''),
        athleteName: String(result.athleteName || result.skfId || 'SKF Athlete'),
        skfId: String(result.skfId || ''),
        branchName: String(result.branchName || 'SKF Karate'),
        belt: formatTournamentBelt(result.belt),
        category: String(result.category || 'kata-individual'),
        ageGroup: String(result.ageGroup || 'sub-junior'),
        weightCategory: String(result.weightCategory || ''),
        difficultyLevel: result.difficultyLevel,
        wins: result.wins,
        medal,
        position: Number(result.position || positionMap[medal] || index + 1),
        photoUrl: resolvedProfilePhoto({
          skfId: String(result.skfId || ''),
          photoUrl: String(result.photoUrl || ''),
        }),
      }
    })
}

function promotedBeltAssignmentsFromBody(body: ActionBody) {
  const source = body.promotions || body.beltAwards || body.promotedBelts || body.promotedTo
  const assignments = new Map<string, string>()

  if (Array.isArray(source)) {
    for (const item of source) {
      if (!item || typeof item !== 'object') continue
      const entry = item as Record<string, unknown>
      const skfId = normaliseSkfId(String(entry.skfId || entry.studentId || ''))
      const belt = String(entry.beltAwarded || entry.promotion || entry.promotedTo || entry.belt || '').trim()
      if (skfId && belt) assignments.set(skfId, belt)
    }
  } else if (source && typeof source === 'object') {
    for (const [skfId, belt] of Object.entries(source as Record<string, unknown>)) {
      const normalizedSkfId = normaliseSkfId(skfId)
      const beltValue = String(belt || '').trim()
      if (normalizedSkfId && beltValue) assignments.set(normalizedSkfId, beltValue)
    }
  }

  return assignments
}

function topPerformerAward(rank: number) {
  return `Top Performer #${rank}`
}

function topPerformerNotes(rank: number) {
  const labels: Record<number, string> = {
    1: 'First top performer in this belt examination.',
    2: 'Second top performer in this belt examination.',
    3: 'Third top performer in this belt examination.',
    4: 'Fourth top performer in this belt examination.',
    5: 'Fifth top performer in this belt examination.',
  }
  return labels[rank] || `Top performer rank ${rank} in this belt examination.`
}

function topPerformerAssignmentsFromBody(body: ActionBody) {
  const source = body.topPerformers || body.bestPerformers || body.performers
  const assignments = new Map<string, {
    rank: number
    award: string
    notes: string
  }>()

  if (!Array.isArray(source)) return assignments

  source.forEach((item, index) => {
    const rankFallback = index + 1
    if (typeof item === 'string') {
      const skfId = normaliseSkfId(item)
      if (skfId) {
        assignments.set(skfId, {
          rank: rankFallback,
          award: topPerformerAward(rankFallback),
          notes: topPerformerNotes(rankFallback),
        })
      }
      return
    }

    if (!item || typeof item !== 'object') return
    const entry = item as Record<string, unknown>
    const skfId = normaliseSkfId(String(entry.skfId || entry.studentId || entry.id || ''))
    if (!skfId) return

    const rank = Math.max(1, Number(entry.rank || entry.position || entry.place || rankFallback) || rankFallback)
    assignments.set(skfId, {
      rank,
      award: String(entry.specialAward || entry.award || topPerformerAward(rank)),
      notes: String(entry.notes || topPerformerNotes(rank)),
    })
  })

  return assignments
}

function applyWorkflowAnnotationsToResults(results: FeeTrackEventResult[], body: ActionBody) {
  const topPerformers = topPerformerAssignmentsFromBody(body)
  const promotions = promotedBeltAssignmentsFromBody(body)

  return results.map((result) => {
    const skfId = normaliseSkfId(String(result.skfId || ''))
    const topPerformer = topPerformers.get(skfId)
    const promotion = promotions.get(skfId)
    const next: FeeTrackEventResult = {
      ...result,
      result: String(result.result || 'pass'),
    }

    if (promotion) {
      next.beltAwarded = String(result.beltAwarded || promotion)
      next.promotion = String(result.promotion || promotion)
    }

    if (topPerformer) {
      next.specialAward = topPerformer.award
      next.award = topPerformer.award
      next.awardRank = topPerformer.rank
      next.notes = result.notes
        ? `${result.notes} • ${topPerformer.notes}`
        : topPerformer.notes
    }

    return next
  })
}

async function updateEventResultsRecord(
  event: FeeTrackEvent,
  results: FeeTrackEventResult[],
  extra: Record<string, unknown> = {}
) {
  const normalizedResults = results.map((result, index) => resultWithParticipantDefaults(event, result, index))

  const payload = event.type === 'tournament'
    ? await withLegacyApiError(() => ({
        ...validateTournamentPayload({
          ...event,
          status: extra.status || event.status || 'completed',
          totalParticipants: Math.max(
            1,
            Number(event.totalParticipants || 0),
            normalizedResults.length,
            (event.participants || []).length
          ),
          skfParticipants: Math.max(
            Number(event.skfParticipants || 0),
            normalizedResults.length,
            (event.participants || []).length
          ),
          venue: event.venue || 'SKF Karate',
          city: event.city || 'Bengaluru',
          state: event.state || 'Karnataka',
          description: event.description || `${event.name} tournament`,
          participants: event.participants || [],
          results: normalizedResults,
          winners: deriveTournamentWinners(normalizedResults),
          isPublished: extra.isPublished ?? event.isPublished,
          showInJourney: extra.showInJourney ?? event.showInJourney,
          resultsAppliedAt: extra.resultsAppliedAt || event.resultsAppliedAt,
        }),
        type: 'tournament',
      }))
    : await withLegacyApiError(() => validateEventPayload({
        ...event,
        status: extra.status || event.status || 'completed',
        participants: event.participants || [],
        results: normalizedResults,
        isResultsPublished: extra.isResultsPublished ?? event.isResultsPublished,
        isPublished: extra.isPublished ?? event.isPublished,
        showInJourney: extra.showInJourney ?? event.showInJourney,
        resultsAppliedAt: extra.resultsAppliedAt || event.resultsAppliedAt,
      }))

  const updated = await withLegacyApiError(() => updateEventRecordLive(event.id, payload as Partial<TournamentRecord>)) as FeeTrackEvent | null
  if (!updated) throw new NotFoundError('Event')
  return updated
}

async function saveEventResultsFromFeeTrack(session: FeeTrackSession, body: ActionBody) {
  assertEventWrite(session)
  const event = await getFeeTrackEvent(session, body.eventId || body.id)
  const results = applyWorkflowAnnotationsToResults(
    Array.isArray(body.results) ? body.results as FeeTrackEventResult[] : [],
    body
  )
  const updated = await updateEventResultsRecord(event, results)

  if (updated.type === 'tournament') {
    revalidateTournamentSitePaths(updated)
  } else {
    revalidateEventSitePaths(updated)
  }

  return { success: true, data: { event: mapEventForFeeTrack(updated) } }
}

async function publishEventResultsFromFeeTrack(session: FeeTrackSession, body: ActionBody) {
  assertEventWrite(session)
  const event = await getFeeTrackEvent(session, body.eventId || body.id)
  const sourceResults = Array.isArray(body.results)
    ? body.results as FeeTrackEventResult[]
    : Array.isArray(event.results)
      ? event.results
      : []
  const annotatedResults = applyWorkflowAnnotationsToResults(sourceResults, body)
  if (annotatedResults.length === 0) {
    throw new ValidationError({ results: ['Record at least one outcome before publishing.'] })
  }

  const saved = await updateEventResultsRecord(event, annotatedResults, {
    status: 'completed',
    isPublished: true,
    isResultsPublished: true,
    showInJourney: true,
  })

  const syncSummary = saved.type === 'tournament'
    ? await syncTournamentResultsToAthletes(saved as Parameters<typeof syncTournamentResultsToAthletes>[0])
    : await syncStandaloneEventResultsToAthletes(saved as Parameters<typeof syncStandaloneEventResultsToAthletes>[0])

  const published = await updateEventResultsRecord(saved, Array.isArray(saved.results) ? saved.results : [], {
    status: 'completed',
    isPublished: true,
    isResultsPublished: true,
    showInJourney: true,
    resultsAppliedAt: new Date().toISOString(),
  })

  if (published.type === 'tournament') {
    revalidateTournamentSitePaths(published)
  } else {
    revalidateEventSitePaths(published)
  }

  for (const skfId of collectParticipantSkfIds(published)) {
    revalidateAthleteSitePaths(skfId)
  }

  return { success: true, data: { event: mapEventForFeeTrack(published), syncSummary } }
}

function revalidateFeeTrackEventPaths(event: FeeTrackEvent) {
  if (event.type === 'tournament') {
    revalidateTournamentSitePaths(event)
  } else {
    revalidateEventSitePaths(event)
  }
}

async function eventForCertificateWorkflow(session: FeeTrackSession, body: ActionBody) {
  const event = await getFeeTrackEvent(session, body.eventId || body.id)
  const results = Array.isArray(body.results) ? body.results as FeeTrackEventResult[] : null

  if (!results) return event

  const updated = await updateEventResultsRecord(event, results)
  revalidateFeeTrackEventPaths(updated)
  return updated
}

function participantCertificateResults(
  event: FeeTrackEvent,
  promotions = new Map<string, string>()
): FeeTrackEventResult[] {
  return (event.participants || []).map((participant, index) => {
    const skfId = normaliseSkfId(String(participant.skfId || ''))
    const promotedBelt = promotions.get(skfId) || ''
    return {
      id: `cert_res_${event.id}_${skfId || index + 1}`,
      participantId: String(participant.id || ''),
      athleteId: String(participant.athleteId || ''),
      athleteName: String(participant.athleteName || skfId || 'SKF Athlete'),
      skfId,
      branchName: String(participant.branchName || ''),
      belt: String(participant.belt || ''),
      photoUrl: resolvedProfilePhoto(participant),
      beltAwarded: promotedBelt,
      promotion: promotedBelt,
      result: 'pass',
      examiner: String(event.affiliatedBody || 'SKF Karate'),
    }
  })
}

function certificateResultsForQrWorkflow(event: FeeTrackEvent, body: ActionBody): FeeTrackEventResult[] {
  if (Array.isArray(body.results)) return body.results as FeeTrackEventResult[]
  if (Array.isArray(event.results) && event.results.length > 0) return event.results
  if (body.fromParticipants === false) return []
  return participantCertificateResults(event, promotedBeltAssignmentsFromBody(body))
}

function certificateNumberAssignmentsFromBody(body: ActionBody): CertificateNumberAssignment[] {
  const source = body.certificateNumbers || body.certificateNumberAssignments || body.certificateAssignments

  if (Array.isArray(source)) {
    return source.flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const entry = item as Record<string, unknown>
      return [{
        skfId: String(entry.skfId || entry.studentId || ''),
        certificateNumber: String(entry.certificateNumber || entry.number || ''),
      }]
    })
  }

  if (source && typeof source === 'object') {
    return Object.entries(source as Record<string, unknown>).map(([skfId, certificateNumber]) => ({
      skfId,
      certificateNumber: String(certificateNumber || ''),
    }))
  }

  return []
}

async function prepareEventCertificateQrsFromFeeTrack(session: FeeTrackSession, body: ActionBody) {
  assertEventWrite(session)
  const event = await getFeeTrackEvent(session, body.eventId || body.id)
  const results = certificateResultsForQrWorkflow(event, body)

  if (results.length === 0) {
    throw new ValidationError({
      results: ['Add event results or keep event participants assigned before generating certificate QR codes.'],
    })
  }

  let certificateSummary = await prepareEventCertificates(event, results)
  const assignments = certificateNumberAssignmentsFromBody(body)
  if (assignments.length > 0) {
    certificateSummary = await assignEventCertificateNumbers(event, assignments)
  }

  if (body.publish === true || body.issue === true || body.publishNow === true) {
    certificateSummary = await publishEventCertificates({
      event,
      results,
      publishedBy: session.user.name || session.user.id || 'FeeTrack',
    })
  }

  for (const certificate of certificateSummary.certificates) {
    revalidateAthleteSitePaths(certificate.skfId)
  }
  revalidateFeeTrackEventPaths(event)
  revalidatePath('/verify')
  revalidateTag('certificates', 'max')

  return {
    success: true,
    data: {
      event: mapEventForFeeTrack(event),
      certificateSummary,
    },
  }
}

function finalizationResultsForEvent(event: FeeTrackEvent, body: ActionBody) {
  if (Array.isArray(body.results) && body.results.length > 0) {
    return applyWorkflowAnnotationsToResults(body.results as FeeTrackEventResult[], body)
  }

  if (Array.isArray(event.results) && event.results.length > 0) {
    return applyWorkflowAnnotationsToResults(event.results, body)
  }

  if (body.fromParticipants === false) return []

  return applyWorkflowAnnotationsToResults(
    participantCertificateResults(event, promotedBeltAssignmentsFromBody(body)),
    body
  )
}

async function finalizeEventWorkflowFromFeeTrack(session: FeeTrackSession, body: ActionBody) {
  assertEventWrite(session)
  const event = await getFeeTrackEvent(session, body.eventId || body.id)
  const results = finalizationResultsForEvent(event, body)

  if (results.length === 0) {
    throw new ValidationError({
      results: ['Record results or keep event participants assigned before finalizing the event workflow.'],
    })
  }

  const published = await updateEventResultsRecord(event, results, {
    status: 'completed',
    isPublished: true,
    isResultsPublished: true,
    showInJourney: true,
    resultsAppliedAt: new Date().toISOString(),
  })

  const syncSummary = published.type === 'tournament'
    ? await syncTournamentResultsToAthletes(published as Parameters<typeof syncTournamentResultsToAthletes>[0])
    : await syncStandaloneEventResultsToAthletes(published as Parameters<typeof syncStandaloneEventResultsToAthletes>[0])

  let certificateSummary = null
  const shouldHandleCertificates = body.certificates !== false && body.skipCertificates !== true
  if (shouldHandleCertificates) {
    const publishedResults = Array.isArray(published.results) ? published.results : results
    certificateSummary = await prepareEventCertificates(published, publishedResults)

    const assignments = certificateNumberAssignmentsFromBody(body)
    if (assignments.length > 0) {
      certificateSummary = await assignEventCertificateNumbers(published, assignments)
    }

    const shouldPublishCertificates = body.publishCertificates !== false &&
      body.issueCertificates !== false &&
      body.publishCertificate !== false

    if (shouldPublishCertificates) {
      certificateSummary = await publishEventCertificates({
        event: published,
        results: publishedResults,
        publishedBy: session.user.name || session.user.id || 'FeeTrack',
      })
    }
  }

  const affectedSkfIds = new Set([
    ...Array.from(collectParticipantSkfIds(published)),
    ...results
      .map((result) => normaliseSkfId(String(result.skfId || '')))
      .filter(Boolean),
  ])

  for (const skfId of affectedSkfIds) {
    revalidateAthleteSitePaths(skfId)
  }
  revalidateFeeTrackEventPaths(published)
  revalidatePath('/verify')
  revalidateTag('certificates', 'max')

  return {
    success: true,
    data: {
      event: mapEventForFeeTrack(published),
      syncSummary,
      certificateSummary,
    },
  }
}

async function getEventCertificatesFromFeeTrack(session: FeeTrackSession, body: ActionBody) {
  const event = await getFeeTrackEvent(session, body.eventId || body.id)
  const certificateSummary = await listEventCertificates(event)

  return {
    success: true,
    data: {
      event: mapEventForFeeTrack(event),
      certificateSummary,
    },
  }
}

async function prepareEventCertificatesFromFeeTrack(session: FeeTrackSession, body: ActionBody) {
  assertEventWrite(session)
  const event = await eventForCertificateWorkflow(session, body)
  const certificateSummary = await prepareEventCertificates(event, Array.isArray(event.results) ? event.results : [])

  return {
    success: true,
    data: {
      event: mapEventForFeeTrack(event),
      certificateSummary,
    },
  }
}

async function publishEventCertificatesFromFeeTrack(session: FeeTrackSession, body: ActionBody) {
  assertEventWrite(session)
  const event = await eventForCertificateWorkflow(session, body)
  const certificateSummary = await publishEventCertificates({
    event,
    results: Array.isArray(event.results) ? event.results : [],
    publishedBy: session.user.name || session.user.id || 'FeeTrack',
  })

  for (const certificate of certificateSummary.certificates) {
    revalidateAthleteSitePaths(certificate.skfId)
  }
  revalidateFeeTrackEventPaths(event)
  revalidatePath('/verify')
  revalidateTag('certificates', 'max')

  return {
    success: true,
    data: {
      event: mapEventForFeeTrack(event),
      certificateSummary,
    },
  }
}

async function getEventCollections(session: FeeTrackSession, body: ActionBody) {
  const branch = normalizeBranch(body.branch, { allowOverall: true })
  const data = await EventFeesService.list(session, {
    year: targetYear(body.year),
    branch,
  })
  return { success: true, data }
}

async function upsertEventFeeConfig(session: FeeTrackSession, body: ActionBody) {
  const source = (body.config && typeof body.config === 'object')
    ? body.config as Record<string, unknown>
    : body
  const result = await EventFeesService.upsertConfig(session, eventFeeConfigSchema.parse(source))
  return { success: true, data: result }
}

async function previewEventFees(session: FeeTrackSession, body: ActionBody) {
  const source = {
    eventId: body.eventId,
    config: body.config,
  }
  const result = await EventFeesService.preview(session, eventFeePreviewSchema.parse(source))
  return { success: true, data: result }
}

async function generateEventFees(session: FeeTrackSession, body: ActionBody) {
  const result = await EventFeesService.generate(session, eventFeeGenerateSchema.parse({
    eventId: body.eventId,
    overrides: body.overrides || [],
  }))
  return { success: true, data: result }
}

async function addEventExpense(session: FeeTrackSession, body: ActionBody) {
  const result = await EventFeesService.createExpense(session, eventFeeExpenseSchema.parse(body))
  return { success: true, data: result }
}

async function addEventDeposit(session: FeeTrackSession, body: ActionBody) {
  const result = await EventFeesService.createDeposit(session, eventFeeDepositSchema.parse(body))
  return { success: true, data: result }
}

function assertPortalContentWrite(session: FeeTrackSession) {
  if (!FEE_TRACK_EVENT_WRITE_ROLES.has(session.user.role)) {
    throw new AuthorizationError('Fee viewer access is read-only.')
  }
}

async function getPortalVideos(session: FeeTrackSession) {
  assertPortalContentWrite(session)
  const videos = await getAllPortalVideosAdmin()
  const folders = await getAllPracticeFoldersAdmin()
  const photos = await getAllPracticePhotosAdmin()
  return { success: true, data: { videos, folders, photos } }
}

async function getHomePracticeAnalyticsForFeeTrack(session: FeeTrackSession, body: ActionBody) {
  assertPortalContentWrite(session)
  const rangeDays = Math.max(1, Math.min(365, Number(body.rangeDays || 90)))
  const analytics = await getHomePracticeAnalytics(rangeDays)
  return { success: true, data: analytics }
}

async function upsertPracticeFolder(session: FeeTrackSession, body: ActionBody) {
  assertPortalContentWrite(session)
  const source = (body.folder && typeof body.folder === 'object')
    ? body.folder as Record<string, unknown>
    : body
  const id = String(body.folderId || source.id || '').trim()
  const folder = id
    ? await updatePracticeFolder(id, { ...source, id })
    : await createPracticeFolder(source)
  revalidatePortalSitePaths()
  return { success: true, data: { folder } }
}

async function deletePracticeFolderFromFeeTrack(session: FeeTrackSession, body: ActionBody) {
  assertPortalContentWrite(session)
  const folderId = String(body.folderId || body.id || '').trim()
  if (!folderId) throw new ValidationError({ folder: ['Folder ID is required.'] })
  await deletePracticeFolder(folderId)
  revalidatePortalSitePaths()
  return { success: true, data: { folderId } }
}

async function deletePracticePhotoFromFeeTrack(session: FeeTrackSession, body: ActionBody) {
  assertPortalContentWrite(session)
  const photoId = String(body.photoId || body.id || '').trim()
  if (!photoId) throw new ValidationError({ photo: ['Photo ID is required.'] })
  await deletePracticePhoto(photoId)
  revalidatePortalSitePaths()
  return { success: true, data: { photoId } }
}

async function upsertPortalVideo(session: FeeTrackSession, body: ActionBody) {
  assertPortalContentWrite(session)
  const source = (body.video && typeof body.video === 'object')
    ? body.video as Record<string, unknown>
    : body
  const id = String(body.videoId || source.id || '').trim()
  const video = id
    ? await updatePortalVideo(id, { ...source, id })
    : await createPortalVideo(source)
  revalidatePortalSitePaths()
  return { success: true, data: { video } }
}

async function deletePortalVideoFromFeeTrack(session: FeeTrackSession, body: ActionBody) {
  assertPortalContentWrite(session)
  const videoId = String(body.videoId || body.id || '').trim()
  if (!videoId) throw new ValidationError({ video: ['Video ID is required.'] })
  await deletePortalVideo(videoId)
  revalidatePortalSitePaths()
  return { success: true, data: { videoId } }
}

type PracticeReorderScope = 'folders' | 'videos' | 'photos'

async function reorderPracticeContentForFeeTrack(session: FeeTrackSession, body: ActionBody) {
  assertPortalContentWrite(session)
  const scope = String(body.scope || body.type || '').trim() as PracticeReorderScope
  if (!['folders', 'videos', 'photos'].includes(scope)) {
    throw new ValidationError({ scope: ['Scope must be one of: folders, videos, photos.'] })
  }
  const orderedIds = Array.isArray(body.orderedIds)
    ? body.orderedIds.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0)
    : []
  if (!orderedIds.length) {
    throw new ValidationError({ orderedIds: ['orderedIds must contain at least one content ID.'] })
  }
  const result = await reorderPracticeContent(scope, orderedIds)
  revalidatePortalSitePaths()
  return { success: true, data: result }
}

async function getBranchTimetables(session: FeeTrackSession) {
  assertPortalContentWrite(session)
  const timetables = await getAllBranchTimetablesAdmin()
  return { success: true, data: { timetables } }
}

async function getGalleryPhotos(session: FeeTrackSession) {
  assertPortalContentWrite(session)
  const photos = await getAllGalleryPhotosAdmin()
  return { success: true, data: { photos, categories: GALLERY_CATEGORY_OPTIONS } }
}

async function getEventGalleryPhotos(session: FeeTrackSession, body: ActionBody) {
  assertPortalContentWrite(session)
  const eventId = String(body.eventId || body.id || '').trim()
  if (!eventId) throw new ValidationError({ eventId: ['Event ID is required.'] })
  const photos = await getEventGalleryPhotosAdmin(eventId)
  return { success: true, data: { photos, categories: GALLERY_CATEGORY_OPTIONS } }
}

async function upsertGalleryPhoto(session: FeeTrackSession, body: ActionBody) {
  assertPortalContentWrite(session)
  const source = (body.photo && typeof body.photo === 'object')
    ? body.photo as Record<string, unknown>
    : body
  const photoId = String(body.photoId || source.id || '').trim()
  const photo = photoId
    ? await updateGalleryPhoto(photoId, { ...source, id: photoId })
    : await createGalleryPhoto(source)
  revalidatePath('/gallery')
  return { success: true, data: { photo } }
}

async function deleteGalleryPhotoFromFeeTrack(session: FeeTrackSession, body: ActionBody) {
  assertPortalContentWrite(session)
  const photoId = String(body.photoId || body.id || '').trim()
  if (!photoId) throw new ValidationError({ photoId: ['Gallery photo ID is required.'] })
  const photo = await deleteGalleryPhoto(photoId)
  revalidatePath('/gallery')
  return { success: true, data: { photoId, photo } }
}

function assertShopWrite(session: FeeTrackSession) {
  if (!FEE_TRACK_EVENT_WRITE_ROLES.has(session.user.role)) {
    throw new AuthorizationError('Fee viewer access is read-only.')
  }
}

function assertReportAccess(session: FeeTrackSession) {
  if (!FEE_TRACK_EVENT_WRITE_ROLES.has(session.user.role)) {
    throw new AuthorizationError('Website analytics access is restricted.')
  }
}

function revalidateShopPaths(productId?: string) {
  revalidatePath('/shop')
  revalidatePath('/shop/orders')
  if (productId) {
    revalidatePath(`/shop/${productId}`)
  }
  revalidateTag(SHOP_PRODUCTS_CACHE_TAG, 'max')
}

async function getShopProducts() {
  const products = await getProducts()
  return { success: true, data: { products } }
}

async function upsertShopProduct(session: FeeTrackSession, body: ActionBody) {
  assertShopWrite(session)
  const source = (body.product && typeof body.product === 'object')
    ? body.product as SaveShopProductInput
    : body as SaveShopProductInput
  const product = await upsertProduct(source)
  revalidateShopPaths(product.id)
  return { success: true, data: { product } }
}

async function getShopOrders() {
  const orders = await getAllShopOrders()
  return { success: true, data: { orders } }
}

async function updateShopOrderStatusFromFeeTrack(session: FeeTrackSession, body: ActionBody) {
  assertShopWrite(session)
  const orderId = String(body.orderId || '').trim()
  const status = String(body.status || '').trim()
  if (!orderId) throw new ValidationError({ orderId: ['Order ID is required.'] })
  if (!status) throw new ValidationError({ status: ['Order status is required.'] })

  const order = await updateShopOrderStatus(orderId, status)
  if (!order) throw new NotFoundError('Shop order')

  revalidateShopPaths()
  return { success: true, data: { order } }
}

async function getWebsiteAnalytics(session: FeeTrackSession, body: ActionBody) {
  assertReportAccess(session)
  const rangeDays = Number(body.rangeDays || 90)
  const result = await getWebsiteAnalyticsSummary({ rangeDays })
  return { success: true, data: result }
}

async function getWebsiteNotifications() {
  const notifications = await getPendingWebsiteSheetNotifications(50)
  return { success: true, data: { notifications } }
}

async function markWebsiteNotificationContacted(session: FeeTrackSession, body: ActionBody) {
  assertShopWrite(session)
  const kind = String(body.kind || '').trim()
  const rowNumber = Number(body.rowNumber || 0)

  if (kind !== 'free_trial' && kind !== 'callback') {
    throw new ValidationError({ kind: ['Website notification kind must be free_trial or callback.'] })
  }

  if (!Number.isInteger(rowNumber) || rowNumber < 2) {
    throw new ValidationError({ rowNumber: ['A valid sheet row number is required.'] })
  }

  const updated = await markWebsiteSheetNotificationContacted(kind, rowNumber)
  if (!updated) throw new NotFoundError('Website notification')

  return { success: true, data: { kind, rowNumber, status: 'Contacted' } }
}

function assertPushSubscription(value: unknown) {
  if (!value || typeof value !== 'object') {
    throw new ValidationError({ subscription: ['Push subscription is required.'] })
  }

  const endpoint = (value as { endpoint?: unknown }).endpoint
  const keys = (value as { keys?: unknown }).keys
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    throw new ValidationError({ subscription: ['Push subscription endpoint is required.'] })
  }

  if (!keys || typeof keys !== 'object') {
    throw new ValidationError({ subscription: ['Push subscription keys are required.'] })
  }

  return value as Parameters<typeof saveFeeTrackPushSubscription>[0]['subscription']
}

async function getPushConfig() {
  return {
    success: true,
    data: {
      publicKey: getFeeTrackPushPublicKey(),
    },
  }
}

async function savePushSubscription(session: FeeTrackSession, body: ActionBody) {
  const subscription = assertPushSubscription(body.subscription)
  const result = await saveFeeTrackPushSubscription({
    staff: session.user,
    subscription,
    userAgent: typeof body.userAgent === 'string' ? body.userAgent : null,
  })

  return { success: true, data: result }
}

async function handleAction(body: ActionBody) {
  if (body.action === 'login') return login(body)

  const session = assertStaff(body)

  switch (body.action) {
    case 'get_students':
      return getStudents(session, body)
    case 'mark_paid':
      return markPaid(session, body)
    case 'mark_paid_with_credit':
      return markPaidWithCredit(session, body)
    case 'mark_break':
      return runStatusAction(session, body, 'mark_break')
    case 'mark_discontinued':
      return runStatusAction(session, body, 'mark_discontinued')
    case 'resume_student':
      return resumeStudent(session, body)
    case 'mark_non_recurring_paid':
      return markNonRecurringPaid(session, body)
    case 'preview_whatsapp_reminder':
      return sendWhatsappReminder(session, body, true)
    case 'send_whatsapp_reminder':
      return sendWhatsappReminder(session, body)
    case 'allocate_exam_fee':
      return allocateExamFee(session, body)
    case 'create_manual_student_fee':
      return createManualStudentFee(session, body)
    case 'get_exam_months':
      return { success: true, data: await FeeOperationsService.getExamMonths(session) }
    case 'set_exam_month':
      if (typeof body.year !== 'number' || typeof body.month !== 'string') {
        throw new ValidationError({ year: ['Year and month are required'] })
      }
      return { success: true, data: await FeeOperationsService.setExamMonth(session, body.year, body.month) }
    case 'get_bb_candidates':
      return { success: true, data: await getAllBBCandidatesAcrossPrograms() }
    case 'update_bb_candidate': {
      const candidateId = String(body.candidateId || '')
      const updates = body.updates as Record<string, unknown>
      if (!candidateId || !updates || typeof updates !== 'object') {
        throw new ValidationError({ candidateId: ['Candidate ID and updates object are required'] })
      }
      const updated = await updateBBCandidateAdmin(candidateId, updates)
      if (!updated) {
        throw new AppError('UPDATE_FAILED', 'Failed to update candidate', 500)
      }
      return { success: true, data: updated }
    }
    case 'add_student':
      throw new ValidationError({
        student: ['Add students from the SKF-Karate admin so DOB, portal login, belt, and billing data stay complete.'],
      })
    case 'get_branch_counts':
      return getBranchCounts(session)
    case 'get_payment_verifications':
      return getPaymentVerifications(session, body)
    case 'approve_payment_verification':
      return approvePaymentVerification(session, body)
    case 'reject_payment_verification':
      return rejectPaymentVerification(session, body)
    case 'get_referral_credits':
      return getCredits(session, body)
    case 'add_referral_credit':
      return addReferralCredit(session, body)
    case 'update_referral_credit':
      return updateReferralCredit(session, body)
    case 'delete_referral_credit':
      return deleteReferralCredit(session, body)
    case 'get_student_credits':
      return getStudentCredits(session, body)
    case 'get_dev_fund':
      return getDevelopmentFund(session, body)
    case 'add_dev_expense':
      return addDevelopmentExpense(session, body)
    case 'delete_dev_expense':
      return deleteDevelopmentExpense(session, body)
    case 'add_extra_income':
      return addExtraIncome(session, body)
    case 'delete_extra_income':
      return deleteExtraIncome(session, body)
    case 'add_removal':
      return addRemoval(session, body)
    case 'delete_removal':
      return deleteRemoval(session, body)
    case 'get_finance_command_center':
      return getFinanceCommandCenter(session, body)
    case 'get_financial_summary':
      return getFinancialSummary(session, body)
    case 'get_admission_dashboard':
      return getAdmissionDashboard(session, body)
    case 'get_admission_applications':
      return getAdmissionApplications(session, body)
    case 'get_admission_application':
      return getAdmissionApplication(session, body)
    case 'reject_admission_application':
      return rejectAdmissionApplication(session, body)
    case 'upsert_admission_promo_code':
      return upsertAdmissionPromoCode(session, body)
    case 'update_admission_branch_settings':
      return updateAdmissionBranchSettings(session, body)
    case 'create_event':
      return createEventFromFeeTrack(session, body)
    case 'update_event':
      return updateEventFromFeeTrack(session, body)
    case 'delete_event':
      return deleteEventFromFeeTrack(session, body)
    case 'search_event_athletes':
      return searchEventAthletes(session, body)
    case 'assign_event_student':
      return assignEventStudent(session, body)
    case 'sync_belt_exam_participants':
      return syncEligibleBeltExamParticipants(session, body)
    case 'remove_event_student':
      return removeEventStudent(session, body)
    case 'save_event_results':
      return saveEventResultsFromFeeTrack(session, body)
    case 'publish_event_results':
      return publishEventResultsFromFeeTrack(session, body)
    case 'finalize_event_workflow':
    case 'finalize_event_results':
    case 'publish_event_workflow':
      return finalizeEventWorkflowFromFeeTrack(session, body)
    case 'prepare_event_certificate_qrs':
    case 'generate_event_certificate_qrs':
      return prepareEventCertificateQrsFromFeeTrack(session, body)
    case 'get_event_certificates':
      return getEventCertificatesFromFeeTrack(session, body)
    case 'prepare_event_certificates':
      return prepareEventCertificatesFromFeeTrack(session, body)
    case 'publish_event_certificates':
      return publishEventCertificatesFromFeeTrack(session, body)
    case 'get_event_collections':
      return getEventCollections(session, body)
    case 'upsert_event_fee_config':
      return upsertEventFeeConfig(session, body)
    case 'preview_event_fees':
      return previewEventFees(session, body)
    case 'generate_event_fees':
      return generateEventFees(session, body)
    case 'add_event_expense':
      return addEventExpense(session, body)
    case 'add_event_deposit':
      return addEventDeposit(session, body)
    case 'get_portal_videos':
      return getPortalVideos(session)
    case 'get_home_practice_analytics':
      return getHomePracticeAnalyticsForFeeTrack(session, body)
    case 'upsert_practice_folder':
      return upsertPracticeFolder(session, body)
    case 'delete_practice_folder':
      return deletePracticeFolderFromFeeTrack(session, body)
    case 'delete_practice_photo':
      return deletePracticePhotoFromFeeTrack(session, body)
    case 'upsert_portal_video':
      return upsertPortalVideo(session, body)
    case 'delete_portal_video':
      return deletePortalVideoFromFeeTrack(session, body)
    case 'reorder_practice_content':
      return reorderPracticeContentForFeeTrack(session, body)
    case 'get_branch_timetables':
      return getBranchTimetables(session)
    case 'get_gallery_photos':
      return getGalleryPhotos(session)
    case 'get_event_gallery_photos':
      return getEventGalleryPhotos(session, body)
    case 'upsert_gallery_photo':
      return upsertGalleryPhoto(session, body)
    case 'delete_gallery_photo':
      return deleteGalleryPhotoFromFeeTrack(session, body)
    case 'get_shop_products':
      return getShopProducts()
    case 'upsert_shop_product':
      return upsertShopProduct(session, body)
    case 'get_shop_orders':
      return getShopOrders()
    case 'update_shop_order_status':
      return updateShopOrderStatusFromFeeTrack(session, body)
    case 'get_website_analytics':
      return getWebsiteAnalytics(session, body)
    case 'get_website_notifications':
      return getWebsiteNotifications()
    case 'mark_website_notification_contacted':
      return markWebsiteNotificationContacted(session, body)
    case 'get_push_config':
      return getPushConfig()
    case 'save_push_subscription':
      return savePushSubscription(session, body)
    default:
      throw new ValidationError({ action: ['Unsupported FeeTrack action.'] })
  }
}

export async function POST(request: Request) {
  let body: ActionBody | null = null
  let rateLimitHeaders: HeadersInit = {}

  try {
    assertApiKey(request)
    rateLimitHeaders = await applyIntegrationRateLimit(request)
    body = await readActionBody(request)
    return json(await handleAction(body), 200, rateLimitHeaders)
  } catch (error) {
    if (error instanceof AppError) {
      const payload = {
        ...integrationContext(body),
        code: error.code,
        status: error.statusCode,
        details: error.expose ? error.details : undefined,
        error,
      }

      if (error.statusCode >= 500) {
        logger.error('feetrack.integration_failed', payload)
      } else {
        logger.info('feetrack.integration_rejected', { ...payload, systemAlert: false })
      }

      return json({
        success: false,
        error: error.message,
        code: error.code,
        details: error.expose ? error.details : undefined,
      }, error.statusCode, error instanceof RateLimitError ? error.headers : rateLimitHeaders)
    }

    if (error instanceof ZodError) {
      const details = error.flatten().fieldErrors
      logger.info('feetrack.integration_rejected', {
        ...integrationContext(body),
        code: 'VALIDATION_ERROR',
        status: 400,
        details,
        error,
        systemAlert: false,
      })

      return json({
        success: false,
        error: 'Invalid input data',
        code: 'VALIDATION_ERROR',
        details,
      }, 400, rateLimitHeaders)
    }

    logger.error('feetrack.integration_failed', {
      ...integrationContext(body),
      error,
    })

    return json({
      success: false,
      error: 'FeeTrack integration failed.',
    }, 500, rateLimitHeaders)
  }
}

export async function GET() {
  return json({
    success: true,
    service: 'SKF-Karate FeeTrack integration',
    configured: Boolean(process.env.FEETRACK_API_KEY),
    features: {
      admissions: true,
      fees: true,
      finance: true,
      events: true,
      gallery: true,
      portal: true,
      shop: true,
    },
  })
}
