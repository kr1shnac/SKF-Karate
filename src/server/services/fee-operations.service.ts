import type { Session } from 'next-auth'
import { createHash, randomUUID } from 'node:crypto'

import { getAllAthletesLive, getAthleteBySkfIdLive, setAthletePortalStatus } from '@/lib/server/repositories/athletes-live'
import { ensureFeeRowsForStudent } from '@/lib/server/repositories/fee-records'
import { getLocalProfilePhotoFile, resolveServerAthleteProfilePhoto } from '@/lib/server/profile-photos'
import { isSupabaseReady, supabaseAdmin } from '@/lib/server/supabase'
import { BLACK_BELT_INSTALLMENT_SOURCE, getBlackBeltOverride } from '@/lib/server/temporary-black-belt-override'
import { normaliseSkfId } from '@/lib/utils/registration'
import { env } from '@/src/server/config/env'
import { AuthorizationError, ExternalServiceError, NotFoundError, ValidationError } from '@/src/server/lib/errors'
import { logger } from '@/src/server/lib/logger'
import { hasTelegramChannel, sendTelegramMessage, sendTelegramPhoto } from '@/src/server/services/telegram.service'
import { FeeReceiptsService } from '@/src/server/services/fee-receipts.service'
import type {
  DevelopmentFundExpenseInput,
  FeeRemovalInput,
  FeeConsoleBulkActionInput,
  FeeConsoleLedgerActionInput,
  FeeConsoleQueryInput,
  FeeDataQualityFixInput,
  FeeFollowupCreateInput,
  FeeCreditCreateInput,
  FeeReminderSendInput,
  PortalFeeProofInput,
  FeeExtraIncomeInput,
  ManualStudentFeeInput,
} from '@/src/server/api/validators/fees.validator'

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

const WRITE_ROLES = new Set(['admin', 'instructor', 'fee_manager'])
const FEE_ACCESS_ROLES = ['admin', 'instructor', 'fee_manager', 'fee_viewer']
const PROOF_BUCKET = 'fee-payment-proofs'
const MAX_PAYMENT_PROOF_BYTES = 5 * 1024 * 1024
const BANGALORE_OPENING_RESERVE = 30000

type FeeStatus = 'paid' | 'due' | 'overdue' | 'pending_verification' | 'break' | 'waived' | 'rejected'
type FeeType =
  | 'monthly'
  | 'admission'
  | 'dress'
  | 'credit_adjustment'
  | 'belt_exam'
  | 'tournament'
  | 'event'
  | 'other'

type AthleteRecord = {
  skfId?: string | null
  firstName?: string | null
  lastName?: string | null
  branchName?: string | null
  gender?: string | null
  photoUrl?: string | null
  monthlyFee?: number | null
  joinDate?: string | null
  status?: string | null
  parentName?: string | null
  phone?: string | null
  email?: string | null
  dateOfBirth?: string | null
}

type FeeRecord = {
  id: string
  skf_id: string
  fee_type: FeeType
  month: string
  year: number
  amount: number
  status: FeeStatus
  paid_date: string | null
  receipt_id: string | null
  payment_method: string | null
  verified_by: string | null
  verified_at: string | null
  rejected_reason: string | null
  notes: string | null
  metadata: Record<string, unknown>
  source_key: string
  source_type: string | null
  source_id: string | null
  source_label: string | null
  due_date: string | null
  branch_snapshot: string | null
  created_at?: string
  updated_at?: string
}

type PaymentProofRow = {
  id: string
  fee_record_id: string | null
  payment_intent_id?: string | null
  skf_id: string
  amount: number
  payment_reference?: string | null
  proof_path: string | null
  proof_filename: string | null
  status: 'submitted' | 'approved' | 'rejected'
  submitted_at: string
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  metadata?: Record<string, unknown> | null
}

type SourcePaymentInput = {
  skfId: string
  feeType?: FeeType
  month?: string
  year?: number
  amount: number
  paymentMethod?: string
  paymentReference?: string
  notes?: string
  metadata?: Record<string, unknown>
  sourceKey: string
  sourceType: string
  sourceId?: string | null
  sourceLabel?: string | null
  branchSnapshot?: string | null
  verifiedBy?: string
  paidAt?: string
}

type FeeCitySlug = 'bangalore' | 'kunigal' | 'tumkur' | 'udupi'

type FeeCity = {
  slug: FeeCitySlug
  name: string
  branches: string[]
  aliases: string[]
}

const FEE_CITIES: FeeCity[] = [
  {
    slug: 'bangalore',
    name: 'Bangalore',
    branches: ['M P Sports Club', 'Herohalli'],
    aliases: ['bangalore', 'bengaluru', 'm p sports club', 'mp sports club', 'mpsc', 'mp', 'herohalli', 'hero'],
  },
  {
    slug: 'kunigal',
    name: 'Kunigal',
    branches: ['Kunigal'],
    aliases: ['kunigal', 'kunigal main'],
  },
  {
    slug: 'tumkur',
    name: 'Tumkur',
    branches: ['Tumkur'],
    aliases: ['tumkur', 'tumakuru', 'tumkur main'],
  },
  {
    slug: 'udupi',
    name: 'Udupi',
    branches: ['Udupi'],
    aliases: ['udupi', 'udupi main'],
  },
]

const BANGALORE_SHARED_EXPENSE_SCOPES = new Set(['both', 'others', 'other', 'all', 'bangalore', 'bengaluru', ''])

function normalizeLocationKey(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function compactLocationKey(value?: string | null) {
  return normalizeLocationKey(value).replace(/\s+/g, '')
}

function resolveCity(value?: string | null): FeeCity | null {
  const normalized = normalizeLocationKey(value)
  const compact = compactLocationKey(value)
  if (!normalized) return null

  return FEE_CITIES.find((city) => {
    if (city.slug === normalized || compactLocationKey(city.name) === compact) return true
    return city.aliases.some((alias) => {
      const aliasKey = normalizeLocationKey(alias)
      return aliasKey === normalized || compactLocationKey(alias) === compact
    })
  }) || null
}

function cityForBranch(branch?: string | null): FeeCity | null {
  return resolveCity(branch)
}

function branchMatchesFilter(branch: string | null | undefined, filter?: string | null) {
  const normalizedFilter = normalizeLocationKey(filter)
  if (!normalizedFilter) return true
  const branchKey = normalizeLocationKey(branch)
  return branchKey === normalizedFilter || compactLocationKey(branch) === compactLocationKey(filter)
}

function branchMatchesCity(branch: string | null | undefined, cityFilter?: string | null) {
  const city = resolveCity(cityFilter)
  if (!city) return true
  return cityForBranch(branch)?.slug === city.slug
}

function cityLabelForBranch(branch?: string | null) {
  const city = cityForBranch(branch)
  return {
    city: city?.name || 'Unmapped',
    citySlug: city?.slug || 'unmapped',
  }
}

function allBranchScope(session: Session) {
  const scope = branchScope(session).toLowerCase()
  return !scope || scope === 'all'
}

function canViewBangaloreFinance(session: Session) {
  return allBranchScope(session) && WRITE_ROLES.has(actorRole(session))
}

function periodLimit(query: FeeConsoleQueryInput) {
  const targetYear = Number(query.year || currentPeriod().year)
  const targetMonth = query.month ? normalizeMonth(query.month) : ''
  const monthLimit = targetMonth ? monthIndex(targetMonth) : 11
  return { targetYear, targetMonth, monthLimit: monthLimit >= 0 ? monthLimit : 11 }
}

function withinMonthLimit(month: string, limit: number) {
  const index = monthIndex(month)
  return index >= 0 && index <= limit
}

function expenseMatchesLocation(scope: unknown, city?: string | null, branch?: string | null) {
  const scopeText = String(scope || '').trim()
  const targetCity = resolveCity(city)
  const branchFilter = String(branch || '').trim()

  if (branchFilter) {
    return branchMatchesFilter(scopeText, branchFilter)
  }

  if (!targetCity) return true

  if (targetCity.slug === 'bangalore' && BANGALORE_SHARED_EXPENSE_SCOPES.has(normalizeLocationKey(scopeText))) {
    return true
  }

  return cityForBranch(scopeText)?.slug === targetCity.slug || resolveCity(scopeText)?.slug === targetCity.slug
}

function requireFeeDatabase() {
  if (!isSupabaseReady()) {
    throw new ExternalServiceError('Fee operations require Supabase to be configured.')
  }
}

function throwFeeDatabaseError(error: unknown): never {
  const details = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const code = String(details.code || '')
  const message = String(details.message || '')
  const hint = String(details.hint || '')
  const combined = `${code} ${message} ${hint}`.toLowerCase()

  if (
    ['42p01', '42703', 'pgrst200', 'pgrst202', 'pgrst204', 'pgrst205'].includes(code.toLowerCase()) ||
    combined.includes('fee_records') ||
    combined.includes('student_billing_profiles') ||
    combined.includes('fee_payment_proofs') ||
    combined.includes('fee_credits') ||
    combined.includes('development_fund_expenses') ||
    combined.includes('fee_audit_logs') ||
    combined.includes('fee_receipts') ||
    combined.includes('fee_receipt_settings') ||
    combined.includes('fee_followups') ||
    combined.includes('fee_payment_intents') ||
    combined.includes('fee_reminder_logs') ||
    combined.includes('fee_extra_incomes') ||
    combined.includes(PROOF_BUCKET)
  ) {
    throw new ExternalServiceError(
      'Fee database schema is not ready. Run database/migrations/015_fee_operations_console.sql through 020_extra_incomes.sql in Supabase, then reload the fee console.',
      { code, message, hint }
    )
  }

  throw new ExternalServiceError('Fee database request failed.', { code, message, hint })
}

function isOptionalWorkflowSchemaError(error: unknown) {
  const details = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const code = String(details.code || '').toLowerCase()
  const message = String(details.message || '').toLowerCase()
  const hint = String(details.hint || '').toLowerCase()
  const combined = `${code} ${message} ${hint}`

  return (
    ['42p01', '42703', 'pgrst200', 'pgrst202', 'pgrst204', 'pgrst205'].includes(code) &&
    (
      combined.includes('fee_payment_intents') ||
      combined.includes('fee_reminder_logs') ||
      combined.includes('event_fee_expenses') ||
      combined.includes('event_fee_deposits') ||
      combined.includes('event_fee_configs') ||
      combined.includes('payment_intent_id') ||
      combined.includes('payment_reference') ||
      combined.includes('metadata')
    )
  )
}

function normalizeMonth(input?: string | null) {
  const normalized = String(input || '').trim().toLowerCase()
  const match = MONTHS.find((month) => {
    const full = month.toLowerCase()
    const short = month.slice(0, 3).toLowerCase()
    return normalized === full || normalized === short
  })
  return match || MONTHS[new Date().getMonth()]
}

function monthIndex(month: string) {
  return MONTHS.findIndex((candidate) => candidate === normalizeMonth(month))
}

function monthFromDateValue(value?: string | null) {
  const parsed = value ? new Date(`${String(value).split('T')[0]}T00:00:00.000Z`) : null
  if (!parsed || !Number.isFinite(parsed.getTime())) return currentPeriod().month
  return MONTHS[parsed.getUTCMonth()]
}

function dateOnly(value?: string | null) {
  const raw = String(value || '').trim().split('T')[0]
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const parsed = new Date(`${raw}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime())) return null
  return raw
}

function todayDateOnly() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = new Map(parts.map((part) => [part.type, part.value]))
  return `${values.get('year')}-${values.get('month')}-${values.get('day')}`
}

function currentPeriod() {
  const now = new Date()
  return { month: MONTHS[now.getMonth()], year: now.getFullYear() }
}

function normalizeAmount(value: unknown) {
  const amount = Number(value || 0)
  return Number.isFinite(amount) ? Math.max(0, amount) : 0
}

function athleteName(athlete?: AthleteRecord | null) {
  return [athlete?.firstName, athlete?.lastName].filter(Boolean).join(' ').trim() || 'SKF Athlete'
}

function actorName(session: Session) {
  return session.user?.name || session.user?.id || 'Fee Staff'
}

function actorRole(session: Session) {
  return session.user?.role || 'fee_viewer'
}

function normalizeIndianPhone(value?: string | null) {
  const digits = String(value || '').replace(/\D+/g, '')
  if (!digits) return ''
  if (digits.length === 10) return `91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return digits
  return digits
}

function buildWhatsAppUrl(phone: string, message: string) {
  const normalizedPhone = normalizeIndianPhone(phone)
  if (!normalizedPhone) return ''
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(message)}`
}

function branchScope(session: Session) {
  return String(session.user?.branchScope || 'all').trim()
}

function canSeeBranch(session: Session, branch?: string | null) {
  const scope = branchScope(session).toLowerCase()
  if (!scope || scope === 'all') return true
  return String(branch || '').trim().toLowerCase() === scope
}

function assertWrite(session: Session) {
  if (!WRITE_ROLES.has(actorRole(session))) {
    throw new AuthorizationError('Fee viewer access is read-only.')
  }
}

async function assertCanAccessSkfId(session: Session, skfId: string) {
  const athlete = await getAthleteBySkfIdLive(skfId)
  if (!athlete) throw new NotFoundError('Student')
  if (!canSeeBranch(session, athlete.branchName)) {
    throw new AuthorizationError('This student is outside your fee branch scope.')
  }
  return athlete as AthleteRecord
}

function normalizeFeeRecord(row: Record<string, unknown>): FeeRecord {
  return {
    id: String(row.id || ''),
    skf_id: normaliseSkfId(String(row.skf_id || '')),
    fee_type: (row.fee_type || 'monthly') as FeeType,
    month: normalizeMonth(String(row.month || '')),
    year: Number(row.year || new Date().getFullYear()),
    amount: normalizeAmount(row.amount),
    status: (row.status || 'due') as FeeStatus,
    paid_date: (row.paid_date as string | null) || null,
    receipt_id: (row.receipt_id as string | null) || null,
    payment_method: (row.payment_method as string | null) || null,
    verified_by: (row.verified_by as string | null) || null,
    verified_at: (row.verified_at as string | null) || null,
    rejected_reason: (row.rejected_reason as string | null) || null,
    notes: (row.notes as string | null) || null,
    metadata: (row.metadata as Record<string, unknown>) || {},
    source_key: String(row.source_key || ''),
    source_type: (row.source_type as string | null) || null,
    source_id: (row.source_id as string | null) || null,
    source_label: (row.source_label as string | null) || null,
    due_date: (row.due_date as string | null) || null,
    branch_snapshot: (row.branch_snapshot as string | null) || null,
    created_at: row.created_at as string | undefined,
    updated_at: row.updated_at as string | undefined,
  }
}

function temporaryMonthlyFeeOverride(
  skfId: string,
  feeType: FeeType,
  month: string,
  year: number,
  options?: { status?: FeeStatus | null; sourceKey?: string | null }
) {
  if (feeType !== 'monthly') return null
  if (options?.status === 'paid') return null
  if (String(options?.sourceKey || '').trim()) return null

  const installment = getBlackBeltOverride(skfId, monthIndex(month), year)
  if (installment) {
    return {
      ...installment,
      source: BLACK_BELT_INSTALLMENT_SOURCE,
    }
  }

  return null
}

function effectiveFeeRecordAmount(row: FeeRecord) {
  return temporaryMonthlyFeeOverride(row.skf_id, row.fee_type, row.month, row.year, {
    status: row.status,
    sourceKey: row.source_key,
  })?.amount ?? normalizeAmount(row.amount)
}

function effectiveFeeRecordSourceLabel(row: FeeRecord) {
  return temporaryMonthlyFeeOverride(row.skf_id, row.fee_type, row.month, row.year, {
    status: row.status,
    sourceKey: row.source_key,
  })?.label || row.source_label
}

async function alignFeeRecordAmountWithTemporaryOverride(row: FeeRecord): Promise<FeeRecord> {
  if (row.status === 'paid') return row

  const override = temporaryMonthlyFeeOverride(row.skf_id, row.fee_type, row.month, row.year, {
    status: row.status,
    sourceKey: row.source_key,
  })
  if (!override) return row

  const currentAmount = normalizeAmount(row.amount)
  const currentLabel = String(row.source_label || '')
  if (currentAmount === override.amount && currentLabel === override.label) return row

  const metadata = {
    ...(row.metadata || {}),
    temporaryOverride: override.source,
    baseAmountBeforeOverride: row.metadata?.baseAmountBeforeOverride ?? currentAmount,
  }
  const { data, error } = await supabaseAdmin
    .from('fee_records')
    .update({
      amount: override.amount,
      source_label: override.label,
      metadata,
      updated_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .select('*')
    .single()
  if (error) throwFeeDatabaseError(error)

  return normalizeFeeRecord(data)
}

async function getFeeRows(filters: {
  year?: number
  month?: string
  skfId?: string
  status?: string
  feeType?: string
  feeRecordId?: string
  sourceType?: string
  sourceId?: string
}) {
  requireFeeDatabase()
  let query = supabaseAdmin
    .from('fee_records')
    .select('id, skf_id, fee_type, month, year, amount, status, paid_date, receipt_id, payment_method, verified_by, verified_at, rejected_reason, notes, metadata, source_key, source_type, source_id, source_label, due_date, branch_snapshot, created_at, updated_at')

  if (filters.year) query = query.eq('year', filters.year)
  if (filters.month) query = query.eq('month', normalizeMonth(filters.month))
  if (filters.skfId) query = query.eq('skf_id', normaliseSkfId(filters.skfId))
  if (filters.status && filters.status !== 'all') query = query.eq('status', filters.status)
  if (filters.feeType && filters.feeType !== 'all') query = query.eq('fee_type', filters.feeType)
  if (filters.feeRecordId) query = query.eq('id', filters.feeRecordId)
  if (filters.sourceType) query = query.eq('source_type', filters.sourceType)
  if (filters.sourceId) query = query.eq('source_id', filters.sourceId)

  const { data, error } = await query.order('year', { ascending: false }).order('month', { ascending: true })
  if (error) throwFeeDatabaseError(error)
  return (data || []).map((row) => normalizeFeeRecord(row))
}

async function getBillingProfile(skfId: string) {
  requireFeeDatabase()
  const { data, error } = await supabaseAdmin
    .from('student_billing_profiles')
    .select('*')
    .eq('skf_id', normaliseSkfId(skfId))
    .maybeSingle()
  if (error) throwFeeDatabaseError(error)
  return data || null
}

function billingProfileAmount(
  feeType: FeeType,
  athlete: AthleteRecord,
  billingProfile?: Record<string, unknown> | null
) {
  if (feeType === 'admission') return normalizeAmount(billingProfile?.admission_fee)
  if (feeType === 'dress') return normalizeAmount(billingProfile?.dress_fee)
  if (feeType === 'credit_adjustment') return 0
  return normalizeAmount(billingProfile?.monthly_fee ?? athlete.monthlyFee)
}

function billingProfileMetadata(feeType: FeeType, billingProfile?: Record<string, unknown> | null) {
  return feeType === 'dress'
    ? { dressCost: normalizeAmount(billingProfile?.dress_cost) }
    : undefined
}

async function upsertBillingProfileFromAthlete(athlete: AthleteRecord, overrides: Record<string, unknown> = {}) {
  requireFeeDatabase()
  const skfId = normaliseSkfId(String(athlete.skfId || ''))
  const payload = {
    skf_id: skfId,
    billing_status: String(overrides.billing_status || 'active'),
    monthly_fee: normalizeAmount(overrides.monthly_fee ?? athlete.monthlyFee),
    billing_start_date: String(overrides.billing_start_date || athlete.joinDate || '').trim() || null,
    branch_snapshot: String(overrides.branch_snapshot || athlete.branchName || '').trim() || null,
    updated_at: new Date().toISOString(),
    ...overrides,
  }

  const { data, error } = await supabaseAdmin
    .from('student_billing_profiles')
    .upsert(payload, { onConflict: 'skf_id' })
    .select('*')
    .single()
  if (error) throwFeeDatabaseError(error)
  return data
}

async function logAudit(session: Session | null, input: {
  action: string
  skfId?: string
  feeRecordId?: string
  before?: unknown
  after?: unknown
  metadata?: Record<string, unknown>
}) {
  if (!isSupabaseReady()) return
  await supabaseAdmin.from('fee_audit_logs').insert({
    actor_id: session?.user?.id || null,
    actor_name: session ? actorName(session) : null,
    actor_role: session ? actorRole(session) : null,
    action: input.action,
    skf_id: input.skfId || null,
    fee_record_id: input.feeRecordId || null,
    before: input.before || null,
    after: input.after || null,
    metadata: input.metadata || {},
  })
}

async function ensureFeeRecord(input: {
  skfId: string
  feeType?: FeeType
  month: string
  year: number
  amount: number
  metadata?: Record<string, unknown>
  sourceKey?: string
  sourceType?: string
  sourceId?: string
  sourceLabel?: string
  dueDate?: string | null
  branchSnapshot?: string
}) {
  requireFeeDatabase()
  const feeType = input.feeType || 'monthly'
  const skfId = normaliseSkfId(input.skfId)
  const month = normalizeMonth(input.month)

  const { data, error } = await supabaseAdmin.rpc('ensure_fee_record', {
    p_skf_id: skfId,
    p_fee_type: feeType,
    p_month: month,
    p_year: input.year,
    p_amount: normalizeAmount(input.amount),
    p_metadata: input.metadata || {},
    p_source_key: input.sourceKey || '',
    p_source_type: input.sourceType || null,
    p_source_id: input.sourceId || null,
    p_source_label: input.sourceLabel || null,
    p_due_date: input.dueDate || null,
    p_branch_snapshot: input.branchSnapshot || null,
  })
  if (error) throwFeeDatabaseError(error)

  const row = Array.isArray(data) ? data[0] : data
  return normalizeFeeRecord(row as Record<string, unknown>)
}

function receiptSourceToken(sourceKey?: string | null, rowId?: string | null) {
  const normalized = String(sourceKey || '').trim()
  if (!normalized) return ''
  const token = normalized
    .replace(/[^a-z0-9]+/gi, '')
    .toUpperCase()
    .slice(-8) || String(rowId || '').replace(/[^a-z0-9]+/gi, '').toUpperCase().slice(0, 8)
  return token ? `-${token}` : ''
}

function buildReceiptId(skfId: string, feeType: FeeType, month: string, year: number, sourceKey?: string | null, rowId?: string | null) {
  return `SKF-FEE-${year}-${receiptMonthNumber(month)}-${receiptTypeCode(feeType)}-${normaliseSkfId(skfId)}${receiptSourceToken(sourceKey, rowId)}`
}

function shouldIssueReceiptForFeeType(feeType: FeeType, amount?: number, skfId?: string, month?: string, year?: number) {
  if (feeType === 'credit_adjustment' || feeType === 'belt_exam') return false
  if (
    feeType === 'monthly' &&
    skfId &&
    month &&
    year &&
    (() => {
      const override = temporaryMonthlyFeeOverride(skfId, feeType, month, year)
      return override && normalizeAmount(amount) === override.amount
    })()
  ) {
    return false
  }
  return true
}

function receiptIdForPaidFee(row: FeeRecord, skfId = row.skf_id, feeType: FeeType = row.fee_type, month = row.month, year = row.year) {
  if (!shouldIssueReceiptForFeeType(feeType, normalizeAmount(row.amount), skfId, month, year)) return null
  return row.receipt_id || buildReceiptId(skfId, feeType, month, year, row.source_key, row.id)
}

async function ensureReceiptForPaidRow(input: {
  row: FeeRecord
  athlete: AthleteRecord
  issuedAt?: string
}) {
  if (
    input.row.status !== 'paid' ||
    !shouldIssueReceiptForFeeType(input.row.fee_type, input.row.amount, input.row.skf_id, input.row.month, input.row.year)
  ) {
    return null
  }

  let row = input.row
  let receiptId = String(row.receipt_id || '').trim()
  if (!receiptId) {
    receiptId = buildReceiptId(row.skf_id, row.fee_type, row.month, row.year, row.source_key, row.id)
    const { data, error } = await supabaseAdmin
      .from('fee_records')
      .update({ receipt_id: receiptId, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .select('*')
      .single()
    if (error) throwFeeDatabaseError(error)
    row = normalizeFeeRecord(data)
  }

  return FeeReceiptsService.ensureReceipt({
    feeRecord: row,
    receiptId,
    studentName: athleteName(input.athlete),
    branch: input.athlete.branchName || 'SKF Branch',
    dojoAddress: dojoAddressForBranch(input.athlete.branchName),
    issuedAt: input.issuedAt,
  })
}

async function voidReceiptForRow(row: FeeRecord, reason: string) {
  if (!row.receipt_id) return null
  return FeeReceiptsService.voidReceipt(row.receipt_id, reason)
}

async function createManualPaymentIntent(input: {
  skfId: string
  row: FeeRecord
  amount: number
  paymentReference?: string
  proofName?: string
}) {
  const { data, error } = await supabaseAdmin
    .from('fee_payment_intents')
    .insert({
      skf_id: input.skfId,
      fee_record_ids: [input.row.id],
      amount: normalizeAmount(input.amount),
      status: 'submitted',
      channel: 'manual_proof',
      payment_reference: input.paymentReference || null,
      provider: 'manual_upi',
      metadata: {
        feeType: input.row.fee_type,
        month: input.row.month,
        year: input.row.year,
        proofName: input.proofName || null,
      },
      created_by: 'portal',
    })
    .select('*')
    .single()

  if (error) {
    if (isOptionalWorkflowSchemaError(error)) return null
    logger.warn('fee.payment_intent_create_failed', {
      skfId: input.skfId,
      feeRecordId: input.row.id,
      error,
    })
    return null
  }

  return data as Record<string, unknown>
}

async function markPaymentIntentStatus(input: {
  intentId?: string | null
  status: 'submitted' | 'paid' | 'rejected' | 'cancelled'
  proofId?: string
  metadata?: Record<string, unknown>
}) {
  if (!input.intentId) return null

  const update: Record<string, unknown> = {
    status: input.status,
    updated_at: new Date().toISOString(),
  }
  if (input.proofId) update.submitted_proof_id = input.proofId
  if (input.metadata) update.metadata = input.metadata

  const { data, error } = await supabaseAdmin
    .from('fee_payment_intents')
    .update(update)
    .eq('id', input.intentId)
    .select('*')
    .maybeSingle()

  if (error) {
    if (isOptionalWorkflowSchemaError(error)) return null
    throwFeeDatabaseError(error)
  }

  return data
}

async function clearProofFileReferences(proofIds: string[], context: {
  action: 'approved' | 'rejected' | 'replaced'
  skfId?: string | null
  feeRecordId?: string | null
}) {
  const ids = Array.from(new Set(proofIds.map((id) => String(id || '').trim()).filter(Boolean)))
  if (!ids.length) return null

  const { data, error } = await supabaseAdmin
    .from('fee_payment_proofs')
    .update({
      proof_path: '',
      proof_filename: null,
    })
    .in('id', ids)
    .select('*')

  if (error) {
    logger.warn('fee.payment_proof_file_reference_cleanup_failed', {
      action: context.action,
      proofIds: ids,
      skfId: context.skfId || null,
      feeRecordId: context.feeRecordId || null,
      error,
    })
    return null
  }

  return (data || []) as PaymentProofRow[]
}

async function cleanupReviewedProofStorage(proof: PaymentProofRow, action: 'approved' | 'rejected') {
  const proofPath = String(proof.proof_path || '').trim()
  if (!proofPath) {
    const [cleaned] = await clearProofFileReferences([proof.id], {
      action,
      skfId: proof.skf_id,
      feeRecordId: proof.fee_record_id,
    }) || []
    return cleaned || proof
  }

  try {
    const { error } = await supabaseAdmin.storage.from(PROOF_BUCKET).remove([proofPath])
    if (error) {
      logger.warn('fee.payment_proof_storage_cleanup_failed', {
        action,
        proofId: proof.id,
        skfId: proof.skf_id,
        feeRecordId: proof.fee_record_id,
        proofPath,
        error,
      })
      return proof
    }
  } catch (error) {
    logger.warn('fee.payment_proof_storage_cleanup_failed', {
      action,
      proofId: proof.id,
      skfId: proof.skf_id,
      feeRecordId: proof.fee_record_id,
      proofPath,
      error,
    })
    return proof
  }

  const [cleaned] = await clearProofFileReferences([proof.id], {
    action,
    skfId: proof.skf_id,
    feeRecordId: proof.fee_record_id,
  }) || []
  return cleaned || proof
}

function outstandingStatus(status: FeeStatus) {
  return status === 'due' || status === 'overdue' || status === 'rejected'
}

function nonBillableStatus(status: FeeStatus) {
  return status === 'break' || status === 'waived'
}

function receiptTypeCode(feeType: FeeType) {
  if (feeType === 'admission') return 'ADM'
  if (feeType === 'dress') return 'DRS'
  if (feeType === 'credit_adjustment') return 'CRD'
  if (feeType === 'belt_exam') return 'BEX'
  if (feeType === 'tournament') return 'TRN'
  if (feeType === 'event') return 'EVT'
  if (feeType === 'other') return 'OTH'
  return 'MON'
}

function receiptMonthNumber(month: string) {
  const index = monthIndex(month)
  return String(index >= 0 ? index + 1 : 0).padStart(2, '0')
}

function trainingMonthCount(startDate: string | null | undefined, endYear: number, endMonth: string) {
  const start = startDate ? new Date(`${String(startDate).split('T')[0]}T00:00:00.000Z`) : null
  if (!start || !Number.isFinite(start.getTime())) return 0

  const endIndex = monthIndex(endMonth)
  if (endIndex < 0) return 0

  const startValue = start.getUTCFullYear() * 12 + start.getUTCMonth()
  const endValue = endYear * 12 + endIndex
  return Math.max(0, endValue - startValue + 1)
}

function periodValue(year: number, month: string) {
  return year * 12 + Math.max(0, monthIndex(month))
}

function formatTrainingExperience(months: number) {
  const safeMonths = Math.max(0, Math.trunc(months))
  const years = Math.floor(safeMonths / 12)
  const remainder = safeMonths % 12
  if (years && remainder) return `${years}y ${remainder}m`
  if (years) return `${years}y`
  return `${remainder}m`
}

function periodEndDate(value: number) {
  const year = Math.floor(value / 12)
  const monthIndex = ((value % 12) + 12) % 12
  return new Date(Date.UTC(year, monthIndex + 1, 0)).toISOString().slice(0, 10)
}

function periodStartDate(year: number, month: string) {
  const index = monthIndex(month)
  const safeMonth = index >= 0 ? index : 0
  return new Date(Date.UTC(year, safeMonth, 1)).toISOString().slice(0, 10)
}

function buildBranchSummary<T extends { branch?: string; amount?: number; status?: FeeStatus; feeType?: string }>(rows: T[]) {
  const byBranch = new Map<string, {
    branch: string
    rows: number
    paidCount: number
    pendingCount: number
    pendingVerificationCount: number
    collected: number
    pending: number
  }>()

  for (const row of rows) {
    const branch = String(row.branch || 'Unknown').trim() || 'Unknown'
    const current = byBranch.get(branch) || {
      branch,
      rows: 0,
      paidCount: 0,
      pendingCount: 0,
      pendingVerificationCount: 0,
      collected: 0,
      pending: 0,
    }
    const amount = normalizeAmount(row.amount)
    current.rows += 1
    if (row.feeType === 'credit_adjustment' || nonBillableStatus(row.status || 'due')) {
      byBranch.set(branch, current)
      continue
    }
    if (row.status === 'paid') {
      current.paidCount += 1
      current.collected += amount
    } else if (row.status === 'pending_verification') {
      current.pendingVerificationCount += 1
    } else if (row.status && outstandingStatus(row.status)) {
      current.pendingCount += 1
      current.pending += amount
    }
    byBranch.set(branch, current)
  }

  return Array.from(byBranch.values()).sort((a, b) => a.branch.localeCompare(b.branch))
}

function buildCitySummary<T extends { branch?: string; amount?: number; status?: FeeStatus; feeType?: string }>(rows: T[]) {
  const base = new Map<string, {
    city: string
    citySlug: string
    rows: number
    paidCount: number
    pendingCount: number
    pendingVerificationCount: number
    collected: number
    pending: number
  }>()

  for (const city of FEE_CITIES) {
    base.set(city.slug, {
      city: city.name,
      citySlug: city.slug,
      rows: 0,
      paidCount: 0,
      pendingCount: 0,
      pendingVerificationCount: 0,
      collected: 0,
      pending: 0,
    })
  }

  for (const row of rows) {
    const location = cityLabelForBranch(row.branch)
    const key = location.citySlug
    const current = base.get(key) || {
      city: location.city,
      citySlug: key,
      rows: 0,
      paidCount: 0,
      pendingCount: 0,
      pendingVerificationCount: 0,
      collected: 0,
      pending: 0,
    }
    const amount = normalizeAmount(row.amount)
    current.rows += 1
    if (row.feeType === 'credit_adjustment' || nonBillableStatus(row.status || 'due')) {
      base.set(key, current)
      continue
    }
    if (row.status === 'paid') {
      current.paidCount += 1
      current.collected += amount
    } else if (row.status === 'pending_verification') {
      current.pendingVerificationCount += 1
    } else if (row.status && outstandingStatus(row.status)) {
      current.pendingCount += 1
      current.pending += amount
    }
    base.set(key, current)
  }

  return Array.from(base.values()).sort((a, b) => {
    const aIndex = FEE_CITIES.findIndex((city) => city.slug === a.citySlug)
    const bIndex = FEE_CITIES.findIndex((city) => city.slug === b.citySlug)
    return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex) || a.city.localeCompare(b.city)
  })
}

function rowToEntry(row: FeeRecord, athlete?: AthleteRecord | null) {
  const branch = String(row.branch_snapshot || athlete?.branchName || '').trim() || 'Unknown'
  const city = cityLabelForBranch(branch)
  const sourceLabel = effectiveFeeRecordSourceLabel(row)
  return {
    id: row.id,
    key: `${row.skf_id}:${row.fee_type}:${row.month}:${row.year}:${row.source_key || ''}`,
    skfId: row.skf_id,
    athleteName: athleteName(athlete),
    branch: row.branch_snapshot || branch,
    city: city.city,
    citySlug: city.citySlug,
    feeType: row.fee_type,
    month: row.month,
    monthIndex: monthIndex(row.month),
    year: row.year,
    amount: effectiveFeeRecordAmount(row),
    status: row.status,
    paidDate: row.paid_date,
    receiptId: row.receipt_id,
    paymentMethod: row.payment_method,
    rejectedReason: row.rejected_reason,
    notes: row.notes,
    metadata: row.metadata || {},
    sourceKey: row.source_key || '',
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceLabel,
    dueDate: row.due_date,
    branchSnapshot: row.branch_snapshot,
  }
}

function formatFeeTypeLabel(input?: string | null) {
  return String(input || 'monthly')
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

function reminderFeeTypeLabel(row: FeeRecord) {
  const sourceLabel = effectiveFeeRecordSourceLabel(row)
  if (sourceLabel) return sourceLabel
  if (row.fee_type === 'monthly') return 'Monthly Fee'
  if (row.fee_type === 'belt_exam') return 'Belt Examination Fee'
  if (row.fee_type === 'tournament') return 'Tournament Fee'
  if (row.fee_type === 'event') return 'Event Fee'
  return formatFeeTypeLabel(row.fee_type)
}

function reminderFeeLine(row: FeeRecord) {
  const amount = effectiveFeeRecordAmount(row)
  const label = reminderFeeTypeLabel(row)
  const period = [row.month, row.year].filter(Boolean).join(' ')
  return `${label}${period ? ` - ${period}` : ''}: ₹${amount.toLocaleString('en-IN')}`
}

function buildFeeReminderMessage(input: {
  parentName: string
  studentName: string
  skfId: string
  rows: FeeRecord[]
  portalUrl: string
}) {
  const total = input.rows.reduce((sum, row) => sum + effectiveFeeRecordAmount(row), 0)
  const feeLines = input.rows.map((row, index) => `${index + 1}. ${reminderFeeLine(row)}`)
  return [
    `Namaste${input.parentName ? ` ${input.parentName}` : ''},`,
    `The following SKF Karate fee${input.rows.length === 1 ? ' is' : 's are'} pending for ${input.studentName} (${input.skfId}):`,
    feeLines.join('\n'),
    `Total pending: ₹${total.toLocaleString('en-IN')}.`,
    `Please clear it as soon as possible and submit the payment proof from the Athlete Portal: ${input.portalUrl}`,
    'If already paid, please ignore this reminder.',
  ].join('\n')
}

function dojoAddressForBranch(branch?: string | null) {
  const key = normalizeLocationKey(branch)
  const map: Record<string, string> = {
    herohalli: 'SKF Karate, Herohalli, Bengaluru',
    'm p sports club': 'SKF Karate, M P Sports Club, Bengaluru',
    'mp sports club': 'SKF Karate, M P Sports Club, Bengaluru',
    mpsc: 'SKF Karate, M P Sports Club, Bengaluru',
    kunigal: 'SKF Karate, Kunigal',
    tumkur: 'SKF Karate, Tumkur',
    tumakuru: 'SKF Karate, Tumkur',
    udupi: 'SKF Karate, Udupi',
  }
  return map[key] || `SKF Karate, ${String(branch || 'SKF Branch').trim() || 'SKF Branch'}`
}

function metadataNumber(metadata: Record<string, unknown> | undefined, key: string) {
  const amount = Number(metadata?.[key] || 0)
  return Number.isFinite(amount) ? Math.max(0, amount) : 0
}

function daysToPay(row: FeeRecord) {
  if (!row.paid_date) return null
  const paidAt = new Date(row.paid_date)
  const dueAt = new Date(Date.UTC(row.year, monthIndex(row.month), 1))
  if (Number.isNaN(paidAt.getTime()) || Number.isNaN(dueAt.getTime())) return null
  return Math.max(0, Math.round((paidAt.getTime() - dueAt.getTime()) / (24 * 60 * 60 * 1000)))
}

function buildFeeHealth(rows: FeeRecord[], targetMonth: string) {
  const monthlyRows = rows
    .filter((row) => row.fee_type === 'monthly')
    .sort((a, b) => monthIndex(a.month) - monthIndex(b.month))
  const paidRows = monthlyRows.filter((row) => row.status === 'paid')
  const rejectedCount = monthlyRows.filter((row) => row.status === 'rejected').length
  const paidDayValues = paidRows
    .map(daysToPay)
    .filter((value): value is number => typeof value === 'number')
  const averageDaysToPay = paidDayValues.length
    ? Math.round(paidDayValues.reduce((sum, value) => sum + value, 0) / paidDayValues.length)
    : null

  let streak = 0
  for (let index = monthIndex(targetMonth); index >= 0; index -= 1) {
    const row = monthlyRows.find((candidate) => monthIndex(candidate.month) === index)
    if (!row || row.status !== 'paid') break
    streak += 1
  }

  let score = 58
  score += Math.min(24, streak * 4)
  if (averageDaysToPay !== null) {
    score += averageDaysToPay <= 7 ? 12 : averageDaysToPay <= 15 ? 5 : -8
  }
  score -= Math.min(24, rejectedCount * 8)
  const latest = monthlyRows.find((row) => row.month === normalizeMonth(targetMonth))
  if (latest?.status === 'paid') score += 6
  if (latest && outstandingStatus(latest.status)) score -= 10
  score = Math.max(0, Math.min(100, Math.round(score)))

  return {
    score,
    label: score >= 82 ? 'steady' : score >= 62 ? 'watch' : 'attention',
    streak,
    averageDaysToPay,
    rejectedCount,
  }
}

function hasKnownExpenseScope(scope: unknown) {
  const normalized = normalizeLocationKey(String(scope || ''))
  if (BANGALORE_SHARED_EXPENSE_SCOPES.has(normalized)) return true
  return Boolean(cityForBranch(String(scope || '')) || resolveCity(String(scope || '')))
}

function compactIssueExamples<T>(items: T[], mapper: (item: T) => Record<string, unknown>) {
  return items.slice(0, 5).map(mapper)
}

function paginateItems<T>(items: T[], query: Pick<FeeConsoleQueryInput, 'limit' | 'offset'>) {
  const requestedLimit = Number(query.limit || 0)
  const enabled = Number.isFinite(requestedLimit) && requestedLimit > 0
  const limit = enabled ? Math.min(200, Math.max(1, requestedLimit)) : items.length
  const offset = enabled ? Math.max(0, Number(query.offset || 0)) : 0
  const pagedItems = enabled ? items.slice(offset, offset + limit) : items

  return {
    items: pagedItems,
    pagination: {
      total: items.length,
      limit,
      offset,
      hasMore: enabled ? offset + limit < items.length : false,
      nextOffset: enabled && offset + limit < items.length ? offset + limit : null,
    },
  }
}

function paginationFromCount(query: Pick<FeeConsoleQueryInput, 'limit' | 'offset'>, total: number) {
  const limit = Math.min(200, Math.max(1, Number(query.limit || 50)))
  const offset = Math.max(0, Number(query.offset || 0))
  return {
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
    nextOffset: offset + limit < total ? offset + limit : null,
  }
}

function decodePaymentProof(input: PortalFeeProofInput) {
  const match = input.paymentProofBase64.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/)
  if (!match) {
    throw new ValidationError({ paymentProofBase64: ['Invalid payment proof image.'] })
  }

  const buffer = Buffer.from(match[2], 'base64')
  if (buffer.length > MAX_PAYMENT_PROOF_BYTES) {
    throw new ValidationError({ paymentProofBase64: ['Payment proof must be 3 MB or smaller.'] })
  }

  return {
    buffer,
    contentType: `image/${match[1] === 'jpg' ? 'jpeg' : match[1]}`,
    extension: match[1] === 'jpeg' ? 'jpg' : match[1],
  }
}

function escapeTelegramMarkdown(value: string) {
  return value.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
}

const MISSING_MONTHLY_ROWS_TELEGRAM_LIMIT = 25

function locationDisplayLabel(value?: string | null) {
  const city = resolveCity(value)
  if (city) return city.name
  return String(value || '').trim()
}

function branchSummaryForMissingRows(students: Array<{ branch?: string | null }>) {
  const counts = new Map<string, number>()
  for (const student of students) {
    const branch = String(student.branch || '').trim() || 'Unknown branch'
    counts.set(branch, (counts.get(branch) || 0) + 1)
  }

  return Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([branch, count]) => `${escapeTelegramMarkdown(branch)}: ${count}`)
    .join(', ')
}

function affectedStudentsKey(students: Array<{ skfId?: string | null; name: string }>) {
  const keys = students.map((student) => {
    const skfId = normaliseSkfId(String(student.skfId || ''))
    return skfId || normalizeLocationKey(student.name)
  })

  return createHash('sha256').update(keys.filter(Boolean).sort().join(',')).digest('hex').slice(0, 24)
}

async function notifyMissingMonthlyRows(input: {
  month: string
  year: number
  count: number
  city?: string | null
  branch?: string | null
  examples: Array<{ skfId?: string | null; name: string; branch?: string | null }>
}) {
  if (!hasTelegramChannel('fees')) return

  const students = input.examples.map((student) => ({
    skfId: normaliseSkfId(String(student.skfId || '')),
    name: String(student.name || 'SKF Athlete').trim() || 'SKF Athlete',
    branch: String(student.branch || '').trim() || 'Unknown branch',
  }))
  const affectedBranches = Array.from(new Set(students.map((student) => student.branch))).sort((left, right) =>
    left.localeCompare(right)
  )
  const affectedKey = affectedStudentsKey(students)
  const alertKey = [
    'missing_monthly_rows',
    input.year,
    input.month,
    affectedKey || `count_${input.count}`,
    affectedBranches.map((branch) => normalizeLocationKey(branch)).join(',') || 'all_branches',
    new Date().toISOString().slice(0, 10),
  ].join(':')

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('fee_audit_logs')
    .select('id')
    .eq('action', 'fee_data_quality_alert_sent')
    .contains('metadata', { alertKey })
    .limit(1)
  if (existingError) {
    logger.warn('fee.data_quality_alert_lookup_failed', { error: existingError })
    return
  }
  if ((existing || []).length) return

  const listedStudents = students.slice(0, MISSING_MONTHLY_ROWS_TELEGRAM_LIMIT)
  const hiddenCount = Math.max(0, input.count - listedStudents.length)
  const studentList = listedStudents
    .map((student) => {
      const skfId = student.skfId ? ` (${escapeTelegramMarkdown(student.skfId)})` : ''
      return `• ${escapeTelegramMarkdown(student.name)}${skfId} - ${escapeTelegramMarkdown(student.branch)}`
    })
    .join('\n')
  const branchLine = branchSummaryForMissingRows(students)
  const cityLabel = locationDisplayLabel(input.city)
  const scopeLabel =
    input.branch
      ? locationDisplayLabel(input.branch)
      : affectedBranches.length === 1
        ? affectedBranches[0]
        : 'All branches'
  const text = [
    '*SKF FeeTrack Data Check*',
    '',
    `Missing monthly rows: *${input.count}*`,
    `Period: ${escapeTelegramMarkdown(input.month)} ${input.year}`,
    cityLabel ? `City: ${escapeTelegramMarkdown(cityLabel)}` : '',
    `Scope: ${escapeTelegramMarkdown(scopeLabel)}`,
    branchLine ? `Branches: ${branchLine}` : '',
    studentList ? '' : '',
    studentList,
    hiddenCount > 0 ? `• +${hiddenCount} more in FeeTrack Data Quality` : '',
    '',
    'Action: FeeTrack > Data Quality > Sync Missing Monthly Rows',
  ].filter(Boolean).join('\n')

  try {
    const result = await sendTelegramMessage({
      channel: 'fees',
      text,
      parseMode: 'Markdown',
      timeoutMs: 5000,
    })
    if (!result.ok) throw new Error(result.error || 'Telegram fees alert failed')
    await logAudit(null, {
      action: 'fee_data_quality_alert_sent',
      metadata: {
        alertKey,
        type: 'missing_monthly_rows',
        month: input.month,
        year: input.year,
        count: input.count,
        city: input.city || '',
        branch: input.branch || '',
        affectedBranches,
        affectedStudents: students.map((student) => student.skfId || student.name),
      },
    })
  } catch (error) {
    logger.warn('fee.data_quality_alert_failed', { error })
  }
}

async function notifyTreasuryAction(title: string, details: string[]) {
  if (!hasTelegramChannel('fees')) return
  const text = [
    `📋 *${title}*`,
    '',
    ...details
  ].filter(Boolean).join('\n')

  try {
    await sendTelegramMessage({
      channel: 'fees',
      text,
      parseMode: 'Markdown',
      timeoutMs: 5000,
    })
  } catch (error) {
    logger.warn('fee.treasury_action_notification_failed', { error })
  }
}

async function notifyPaymentProofSubmitted(input: {
  skfId: string
  studentName: string
  branch?: string | null
  feeType: string
  month: string
  year: number
  amount: number
  proofId: string
  paymentReference?: string | null
  proofBuffer?: Buffer
  proofFilename?: string
  proofContentType?: string
}) {
  if (!hasTelegramChannel('fees')) {
    logger.warn('fee.payment_proof_alert_missing_channel', { channel: 'fees' })
    return
  }

  const siteUrl = String(env.NEXT_PUBLIC_SITE_URL || env.NEXT_PUBLIC_APP_URL || 'https://www.skfkarate.org').replace(/\/$/, '')
  const text = [
    'SKF Payment Proof Submitted',
    '',
    `Student: ${input.studentName} (${input.skfId})`,
    input.branch ? `Branch: ${input.branch}` : '',
    `Fee: ${formatFeeTypeLabel(input.feeType)} / ${input.month} ${input.year}`,
    `Amount: ₹${input.amount.toLocaleString('en-IN')}`,
    input.paymentReference ? `Reference: ${input.paymentReference}` : '',
    `Submitted: ${new Date().toLocaleString('en-IN')}`,
    '',
    `Review Pending Proofs: ${siteUrl.replace('www.skfkarate.org', 'fees.skfkarate.org')}/payments?status=pending_verification`,
  ].filter(Boolean).join('\n')

  try {
    if (input.proofBuffer) {
      const blob = new Blob([new Uint8Array(input.proofBuffer)], { type: input.proofContentType || 'image/png' })
      const photoResult = await sendTelegramPhoto({
        channel: 'fees',
        photo: blob,
        filename: input.proofFilename || 'proof.png',
        caption: text,
        timeoutMs: 15000,
      })

      if (photoResult.ok) return

      logger.warn('fee.payment_proof_photo_alert_failed', {
        status: photoResult.status,
        skipped: photoResult.skipped,
        error: photoResult.error,
      })
    }

    const messageResult = await sendTelegramMessage({
      channel: 'fees',
      text,
      timeoutMs: 10000,
    })
    if (!messageResult.ok) {
      logger.warn('fee.payment_proof_alert_failed', {
        status: messageResult.status,
        skipped: messageResult.skipped,
        error: messageResult.error,
      })
    }
  } catch (error) {
    logger.warn('fee.payment_proof_alert_failed', { error })

    try {
      await sendTelegramMessage({
        channel: 'fees',
        text,
        timeoutMs: 10000,
      })
    } catch (fallbackError) {
      logger.warn('fee.payment_proof_alert_fallback_failed', { error: fallbackError })
    }
  }
}

export class FeeOperationsService {
  static roles = FEE_ACCESS_ROLES

  static async recordPaidSourcePayment(input: SourcePaymentInput) {
    requireFeeDatabase()

    const skfId = normaliseSkfId(input.skfId)
    const sourceKey = String(input.sourceKey || '').trim()
    const sourceType = String(input.sourceType || '').trim()
    const amount = normalizeAmount(input.amount)

    if (!skfId) {
      throw new ValidationError({ skfId: ['SKF ID is required.'] })
    }

    if (!sourceKey || !sourceType) {
      throw new ValidationError({ source: ['Source key and source type are required.'] })
    }

    if (amount <= 0) {
      return { success: true, skipped: true, reason: 'zero_amount' as const }
    }

    const athlete = await getAthleteBySkfIdLive(skfId)
    if (!athlete) throw new NotFoundError('Student')

    const paidAt = input.paidAt || new Date().toISOString()
    const paidDate = new Date(paidAt)
    const month = normalizeMonth(input.month || MONTHS[paidDate.getMonth()])
    const year = Number(input.year || paidDate.getFullYear() || new Date().getFullYear())
    const feeType = input.feeType || 'other'
    const metadata = input.metadata || {}
    const sourceLabel = String(input.sourceLabel || '').trim() || null
    const sourceId = String(input.sourceId || '').trim() || undefined
    const branchSnapshot = String(input.branchSnapshot || athlete.branchName || '').trim() || null

    const row = await ensureFeeRecord({
      skfId,
      feeType,
      month,
      year,
      amount,
      metadata,
      sourceKey,
      sourceType,
      sourceId,
      sourceLabel: sourceLabel || undefined,
      branchSnapshot: branchSnapshot || undefined,
    })
    const before = row
    const receiptId = receiptIdForPaidFee(row, skfId, feeType, month, year)
    const paymentMethod = [input.paymentMethod || 'source_payment', input.paymentReference || '']
      .filter(Boolean)
      .join(' - ')

    const { data, error } = await supabaseAdmin
      .from('fee_records')
      .update({
        status: 'paid',
        amount,
        paid_date: paidAt,
        receipt_id: receiptId,
        payment_method: paymentMethod,
        verified_by: input.verifiedBy || 'System',
        verified_at: paidAt,
        rejected_reason: null,
        notes: input.notes || null,
        metadata: { ...(row.metadata || {}), ...metadata },
        source_type: sourceType,
        source_id: sourceId,
        source_label: sourceLabel,
        branch_snapshot: branchSnapshot,
        updated_at: paidAt,
      })
      .eq('id', row.id)
      .select('*')
      .single()
    if (error) throwFeeDatabaseError(error)

    const after = normalizeFeeRecord(data)
    const receipt = await ensureReceiptForPaidRow({ row: after, athlete, issuedAt: paidAt })
    await logAudit(null, {
      action: 'fee_source_payment_recorded',
      skfId,
      feeRecordId: after.id,
      before,
      after,
      metadata: { sourceType, sourceId, sourceKey },
    })

    return { success: true, skipped: false as const, entry: rowToEntry(after, athlete), receipt }
  }

  static async createManualStudentFee(session: Session, input: ManualStudentFeeInput) {
    assertWrite(session)
    requireFeeDatabase()

    const skfId = normaliseSkfId(input.skfId)
    const amount = normalizeAmount(input.amount)
    const title = String(input.title || '').trim()
    const description = String(input.description || '').trim()
    const month = normalizeMonth(input.month)
    const year = Number(input.year || new Date().getFullYear())

    if (!skfId) throw new ValidationError({ skfId: ['SKF ID is required.'] })
    if (!title) throw new ValidationError({ title: ['Fee title is required.'] })
    if (amount <= 0) throw new ValidationError({ amount: ['Amount must be greater than zero.'] })

    const athlete = await getAthleteBySkfIdLive(skfId)
    if (!athlete) throw new NotFoundError('Student')

    const sourceId = `manual_${randomUUID()}`
    const sourceKey = `manual_fee:${sourceId}`
    const dueDate = dateOnly(input.dueDate) || todayDateOnly()
    const now = new Date().toISOString()
    const metadata = {
      manualFee: true,
      title,
      description: description || null,
      createdBy: actorName(session),
      createdAt: now,
    }

    const before = await ensureFeeRecord({
      skfId,
      feeType: 'other',
      month,
      year,
      amount,
      metadata,
      sourceKey,
      sourceType: 'manual_student_fee',
      sourceId,
      sourceLabel: title,
      dueDate,
      branchSnapshot: String(athlete.branchName || '').trim() || undefined,
    })

    const { data, error } = await supabaseAdmin
      .from('fee_records')
      .update({
        status: 'due',
        amount,
        paid_date: null,
        receipt_id: null,
        payment_method: null,
        verified_by: null,
        verified_at: null,
        rejected_reason: null,
        notes: description || `Manual student fee: ${title}`,
        metadata,
        source_type: 'manual_student_fee',
        source_id: sourceId,
        source_label: title,
        due_date: dueDate,
        branch_snapshot: String(athlete.branchName || '').trim() || null,
        updated_at: now,
      })
      .eq('id', before.id)
      .select('*')
      .single()
    if (error) throwFeeDatabaseError(error)

    const after = normalizeFeeRecord(data)
    await logAudit(session, {
      action: 'manual_student_fee_created',
      skfId,
      feeRecordId: after.id,
      before,
      after,
      metadata: { title, amount, dueDate, month, year },
    })

    return { success: true, entry: rowToEntry(after, athlete) }
  }

  static async getStudents(session: Session, query: FeeConsoleQueryInput) {
    const period = currentPeriod()
    const targetMonth = query.month ? normalizeMonth(query.month) : period.month
    const targetYear = Number(query.year || period.year)
    const search = String(query.search || '').trim().toLowerCase()
    const branchFilter = String(query.branch || '').trim()

    const [athletes, rows, creditRows, historyRows, billingProfileRows, followupRows] = await Promise.all([
      getAllAthletesLive() as Promise<AthleteRecord[]>,
      getFeeRows({ year: targetYear, month: targetMonth, feeType: 'monthly' }),
      getFeeRows({ year: targetYear, month: targetMonth, feeType: 'credit_adjustment', status: 'paid' }),
      getFeeRows({ year: targetYear, feeType: 'monthly' }),
      supabaseAdmin
        .from('student_billing_profiles')
        .select('skf_id, billing_status, billing_start_date, billing_end_date'),
      supabaseAdmin
        .from('fee_followups')
        .select('id, skf_id, fee_type, month, year, contacted_by, contacted_by_role, contact_method, note, created_at')
        .eq('year', targetYear)
        .eq('month', targetMonth)
        .eq('fee_type', 'monthly')
        .order('created_at', { ascending: false }),
    ])
    if (billingProfileRows.error) throwFeeDatabaseError(billingProfileRows.error)
    if (followupRows.error) throwFeeDatabaseError(followupRows.error)

    const rowBySkfId = new Map(rows.map((row) => [row.skf_id, row]))
    const creditBySkfId = new Map<string, number>()
    for (const row of creditRows) {
      creditBySkfId.set(row.skf_id, (creditBySkfId.get(row.skf_id) || 0) + normalizeAmount(row.amount))
    }
    const historyBySkfId = new Map<string, FeeRecord[]>()
    for (const row of historyRows) {
      const current = historyBySkfId.get(row.skf_id) || []
      current.push(row)
      historyBySkfId.set(row.skf_id, current)
    }
    const billingBySkfId = new Map(
      (billingProfileRows.data || []).map((profile) => [
        normaliseSkfId(String(profile.skf_id || '')),
        profile as Record<string, unknown>,
      ])
    )
    const latestFollowupBySkfId = new Map<string, Record<string, unknown>>()
    for (const followup of followupRows.data || []) {
      const skfId = normaliseSkfId(String(followup.skf_id || ''))
      if (!latestFollowupBySkfId.has(skfId)) {
        latestFollowupBySkfId.set(skfId, {
          id: followup.id,
          skfId,
          feeType: followup.fee_type,
          contactMethod: followup.contact_method,
          contactedBy: followup.contacted_by,
          contactedByRole: followup.contacted_by_role,
          note: followup.note,
          createdAt: followup.created_at,
        })
      }
    }
    const visibleStudents = athletes
      .filter((athlete) => String(athlete.status || 'active').toLowerCase() === 'active')
      .filter((athlete) => canSeeBranch(session, athlete.branchName))
      .filter((athlete) => branchMatchesCity(athlete.branchName, query.city))
      .map((athlete) => {
        const skfId = normaliseSkfId(String(athlete.skfId || ''))
        const row = rowBySkfId.get(skfId)
        const billingProfile = billingBySkfId.get(skfId)
        const history = historyBySkfId.get(skfId) || []
        const targetValue = periodValue(targetYear, targetMonth)
        const lastPaidValue = history
          .filter((entry) => entry.status === 'paid')
          .reduce((latest, entry) => Math.max(latest, periodValue(entry.year, entry.month)), -1)
        const billingEndDate = String(billingProfile?.billing_end_date || '').trim()
        const billingEnd = billingEndDate ? new Date(`${billingEndDate.split('T')[0]}T00:00:00.000Z`) : null
        const billingEndValue = billingEnd && Number.isFinite(billingEnd.getTime())
          ? billingEnd.getUTCFullYear() * 12 + billingEnd.getUTCMonth()
          : -1
        const discontinuedStopValue = Math.max(lastPaidValue, billingEndValue)
        const joiningDateString = String(billingProfile?.billing_start_date || athlete.joinDate || '').trim()
        const joiningDate = joiningDateString ? new Date(`${joiningDateString.split('T')[0]}T00:00:00.000Z`) : null
        const joiningValue = joiningDate && Number.isFinite(joiningDate.getTime())
          ? joiningDate.getUTCFullYear() * 12 + joiningDate.getUTCMonth()
          : -1

        let status = (row?.status || 'due') as FeeStatus
        if (
          String(billingProfile?.billing_status || '').toLowerCase() === 'discontinued' &&
          discontinuedStopValue >= 0 &&
          targetValue > discontinuedStopValue
        ) {
          status = 'waived'
        } else if (joiningValue >= 0 && targetValue < joiningValue) {
          status = 'waived'
        }
        const experienceEndValue = status === 'waived' && discontinuedStopValue >= 0
          ? Math.min(targetValue, discontinuedStopValue)
          : targetValue
        const experienceEndYear = Math.floor(experienceEndValue / 12)
        const experienceEndMonth = MONTHS[((experienceEndValue % 12) + 12) % 12]
        const knownBreakMonths = new Set(
          history
            .filter((entry) => entry.status === 'break')
            .filter((entry) => periodValue(entry.year, entry.month) <= experienceEndValue)
            .map((entry) => `${entry.year}-${entry.month}`)
        ).size
        const trainingMonths = Math.max(
          0,
          trainingMonthCount(athlete.joinDate, experienceEndYear, experienceEndMonth) - knownBreakMonths
        )
        let baseAmount = row?.amount ?? normalizeAmount(athlete.monthlyFee)

        const mIndex = MONTHS.indexOf(targetMonth)
        const monthlyOverride = temporaryMonthlyFeeOverride(skfId, 'monthly', targetMonth, targetYear, row
          ? { status: row.status, sourceKey: row.source_key }
          : undefined)
        if (monthlyOverride) {
          baseAmount = monthlyOverride.amount
        }

        const creditApplied = creditBySkfId.get(skfId) || 0
        const amount = Math.max(0, baseAmount - creditApplied)
        const city = cityLabelForBranch(athlete.branchName)
        const photoUrl = String(athlete.photoUrl || '').trim()
        const localProfilePhoto = getLocalProfilePhotoFile(skfId)
        const hasProfilePhoto = Boolean(photoUrl && !photoUrl.includes('/no-profile/')) || Boolean(localProfilePhoto)
        const resolvedPhotoUrl = resolveServerAthleteProfilePhoto({
          skfId,
          photoUrl,
          gender: athlete.gender || '',
        })
        return {
          skfId,
          name: athleteName(athlete),
          branch: athlete.branchName || '',
          city: city.city,
          citySlug: city.citySlug,
          gender: athlete.gender || '',
          photoUrl: resolvedPhotoUrl,
          hasProfilePhoto,
          parentName: athlete.parentName || '',
          phone: athlete.phone || '',
          email: athlete.email || '',
          dateOfBirth: athlete.dateOfBirth || '',
          joinDate: athlete.joinDate || '',
          amount: nonBillableStatus(status) ? 0 : amount,
          originalAmount: baseAmount,
          creditApplied: nonBillableStatus(status) ? 0 : creditApplied,
          status,
          feeRecordId: row?.id || null,
          paidDate: row?.paid_date || null,
          receiptId: row?.receipt_id || null,
          rejectedReason: row?.rejected_reason || null,
          billingStatus: String(billingProfile?.billing_status || 'active'),
          billingEndDate: billingEndDate || '',
          latestFollowup: latestFollowupBySkfId.get(skfId) || null,
          trainingMonths,
          trainingExperience: formatTrainingExperience(trainingMonths),
          health: buildFeeHealth(history, targetMonth),
          isExamInstallment: Boolean(monthlyOverride) && mIndex >= 0
        }
      })
      .filter((student) => {
        if (!search) return true
        return (
          student.skfId.toLowerCase().includes(search) ||
          student.name.toLowerCase().includes(search) ||
          student.branch.toLowerCase().includes(search)
        )
      })
      .filter((student) => (query.status && query.status !== 'all' ? student.status === query.status : true))
      .sort((a, b) => a.skfId.localeCompare(b.skfId, undefined, { numeric: true }))
    const defaultBillableStudents = query.status && query.status !== 'all'
      ? visibleStudents
      : visibleStudents.filter((student) => !nonBillableStatus(student.status))
    const citySummary = buildCitySummary(defaultBillableStudents)
    const branchSummary = buildBranchSummary(defaultBillableStudents)
    const students = defaultBillableStudents
      .filter((student) => branchMatchesFilter(student.branch, branchFilter))

    const paid = students.filter((student) => student.status === 'paid')
    const pending = students.filter((student) => outstandingStatus(student.status))
    const pendingVerification = students.filter((student) => student.status === 'pending_verification')

    return {
      filters: { month: targetMonth, year: targetYear, city: query.city || '', branch: query.branch || 'all', search: query.search || '' },
      summary: {
        students: students.length,
        paidCount: paid.length,
        pendingCount: pending.length,
        pendingVerificationCount: pendingVerification.length,
        expected: students.reduce((sum, row) => sum + row.amount, 0),
        collected: paid.reduce((sum, row) => sum + row.amount, 0),
        pending: pending.reduce((sum, row) => sum + row.amount, 0),
        collectionRate: students.length ? Math.round((paid.length / students.length) * 100) : 0,
      },
      citySummary,
      branchSummary,
      students,
    }
  }

  static async getDashboard(session: Session, query: FeeConsoleQueryInput) {
    const studentData = await this.getStudents(session, query)
    const [rows, dataQuality] = await Promise.all([
      this.getLedger(session, {
        ...query,
        year: studentData.filters.year,
        month: studentData.filters.month,
      }),
      this.getDataQuality(session, {
        ...query,
        year: studentData.filters.year,
        month: studentData.filters.month,
      }),
    ])

    const monthlyPaid = rows.entries
      .filter((entry) => entry.status === 'paid' && entry.feeType === 'monthly')
      .reduce((sum, entry) => sum + normalizeAmount(entry.amount), 0)
    const verifiedCash = Math.max(0, monthlyPaid - rows.summary.creditsUsed)
    const reconciliation = this.buildReconciliation(studentData, dataQuality)

    return {
      ...studentData,
      dataQuality,
      reconciliation,
      finance: {
        totalRows: rows.summary.totalRows,
        overdueCount: rows.summary.overdueCount,
        breakCount: rows.summary.breakCount,
        waivedCount: rows.summary.waivedCount,
        creditsUsed: rows.summary.creditsUsed,
        verifiedCash,
        developmentFundAllocation: Math.round(Math.max(0, verifiedCash) * 0.3),
      },
    }
  }

  static async getFinance(session: Session, query: FeeConsoleQueryInput) {
    const requestedCity = resolveCity(query.city || 'bangalore')
    const targetCity = requestedCity?.slug || 'bangalore'
    const { targetYear, targetMonth, monthLimit } = periodLimit({
      ...query,
      city: 'bangalore',
    })
    const periodLabel = targetMonth ? `January-${targetMonth} ${targetYear}` : `January-December ${targetYear}`

    if (targetCity !== 'bangalore') {
      return {
        restricted: true,
        restrictedReason: 'Bank position is available only for Bangalore city branches.',
        city: requestedCity?.name || query.city || '',
        period: { year: targetYear, month: targetMonth || 'All', label: periodLabel },
        citySummary: [],
        branchSummary: [],
        bankPosition: null,
        monthlyBreakdown: [],
        dataQuality: await this.getDataQuality(session, { ...query, year: targetYear }),
      }
    }

    if (!canViewBangaloreFinance(session)) {
      return {
        restricted: true,
        restrictedReason: 'Bangalore bank position requires all-branch fee write access.',
        city: 'Bangalore',
        period: { year: targetYear, month: targetMonth || 'All', label: periodLabel },
        citySummary: [],
        branchSummary: [],
        bankPosition: null,
        monthlyBreakdown: [],
        dataQuality: await this.getDataQuality(session, { ...query, city: 'bangalore', year: targetYear }),
      }
    }

    const ledger = await this.getLedger(session, {
      year: targetYear,
      city: 'bangalore',
      branch: query.branch,
      feeType: 'all',
      search: query.search,
    })

    const [
      { data: expenseRows, error: expenseError },
      { data: incomeRows, error: incomeError },
      eventExpenseRows,
      eventDepositRows,
      { data: removalRows, error: removalError },
    ] = await Promise.all([
      supabaseAdmin
        .from('development_fund_expenses')
        .select('*')
        .eq('year', targetYear)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('fee_extra_incomes')
        .select('*')
        .eq('year', targetYear)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('event_fee_expenses')
        .select('*')
        .gte('expense_date', `${targetYear}-01-01`)
        .lte('expense_date', `${targetYear}-12-31`)
        .is('deleted_at', null)
        .order('expense_date', { ascending: false }),
      supabaseAdmin
        .from('event_fee_deposits')
        .select('*')
        .gte('deposit_date', `${targetYear}-01-01`)
        .lte('deposit_date', `${targetYear}-12-31`)
        .is('deleted_at', null)
        .order('deposit_date', { ascending: false }),
      supabaseAdmin
        .from('fee_removals')
        .select('*')
        .eq('year', targetYear)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
    ])
    if (expenseError) throwFeeDatabaseError(expenseError)
    if (incomeError && !isOptionalWorkflowSchemaError(incomeError)) throwFeeDatabaseError(incomeError)
    if (eventExpenseRows.error && !isOptionalWorkflowSchemaError(eventExpenseRows.error)) throwFeeDatabaseError(eventExpenseRows.error)
    if (eventDepositRows.error && !isOptionalWorkflowSchemaError(eventDepositRows.error)) throwFeeDatabaseError(eventDepositRows.error)
    if (removalError && !isOptionalWorkflowSchemaError(removalError)) throwFeeDatabaseError(removalError)

    const relevantExpenses = (expenseRows || [])
      .filter((expense) => expenseMatchesLocation(expense.scope, 'bangalore', query.branch))
      .filter((expense) => withinMonthLimit(normalizeMonth(expense.month), monthLimit))

    const relevantIncomes = (incomeRows || [])
      .filter((income) => expenseMatchesLocation(income.scope, 'bangalore', query.branch))
      .filter((income) => withinMonthLimit(normalizeMonth(income.month), monthLimit))

    const relevantEventExpenses = (eventExpenseRows.data || [])
      .filter((expense) => expenseMatchesLocation(expense.branch_scope, 'bangalore', query.branch))
      .filter((expense) => withinMonthLimit(monthFromDateValue(expense.expense_date), monthLimit))

    const relevantEventDeposits = (eventDepositRows.data || [])
      .filter((deposit) => expenseMatchesLocation(deposit.branch_scope, 'bangalore', query.branch))
      .filter((deposit) => withinMonthLimit(monthFromDateValue(deposit.deposit_date), monthLimit))

    const relevantRemovals = (removalRows || [])
      .filter((removal) => expenseMatchesLocation(removal.scope, 'bangalore', query.branch))
      .filter((removal) => withinMonthLimit(normalizeMonth(removal.month), monthLimit))

    const buildFinanceBreakdown = (
      year: number,
      sourceEntries: typeof ledger.entries,
      sourceExpenses: typeof relevantExpenses,
      sourceIncomes: typeof relevantIncomes,
      sourceEventExpenses: typeof relevantEventExpenses,
      sourceEventDeposits: typeof relevantEventDeposits,
      sourceRemovals: typeof relevantRemovals
    ) => {
      const entries = sourceEntries.filter((entry) => withinMonthLimit(entry.month, monthLimit))
      const paidEntries = entries.filter((entry) => entry.status === 'paid')
      const breakdown = MONTHS.map((month) => {
        const monthEntries = paidEntries.filter((entry) => entry.month === month)
        const monthlyCollected = monthEntries
          .filter((entry) => entry.feeType === 'monthly')
          .reduce((sum, entry) => sum + normalizeAmount(entry.amount), 0)
        const creditsApplied = monthEntries
          .filter((entry) => entry.feeType === 'credit_adjustment')
          .reduce((sum, entry) => sum + normalizeAmount(entry.amount), 0)
        const monthlyCash = Math.max(0, monthlyCollected - creditsApplied)
        const admissionCollected = monthEntries
          .filter((entry) => entry.feeType === 'admission')
          .reduce((sum, entry) => sum + normalizeAmount(entry.amount), 0)
        const dressRevenue = monthEntries
          .filter((entry) => entry.feeType === 'dress')
          .reduce((sum, entry) => sum + normalizeAmount(entry.amount), 0)
        const dressCost = monthEntries
          .filter((entry) => entry.feeType === 'dress')
          .reduce((sum, entry) => sum + metadataNumber(entry.metadata, 'dressCost'), 0)
        const dressProfit = dressRevenue - dressCost
        const extraIncome = sourceIncomes
          .filter((income) => normalizeMonth(income.month) === month)
          .reduce((sum, income) => sum + normalizeAmount(income.amount), 0)
        const eventIncome = monthEntries
          .filter((entry) => ['belt_exam', 'tournament', 'event', 'other'].includes(entry.feeType))
          .reduce((sum, entry) => sum + normalizeAmount(entry.amount), 0)
        const grossIncome = monthlyCash + admissionCollected + dressProfit + extraIncome + eventIncome
        const developmentAllocation = Math.round(Math.max(0, monthlyCash) * 0.3)
        const developmentExpenses = sourceExpenses
          .filter((expense) => normalizeMonth(expense.month) === month)
          .reduce((sum, expense) => sum + normalizeAmount(expense.amount), 0)
        const eventExpenses = sourceEventExpenses
          .filter((expense) => monthFromDateValue(expense.expense_date) === month)
          .reduce((sum, expense) => sum + normalizeAmount(expense.amount), 0)
        const eventDeposits = sourceEventDeposits
          .filter((deposit) => monthFromDateValue(deposit.deposit_date) === month)
          .reduce((sum, deposit) => sum + normalizeAmount(deposit.amount), 0)
        const customRemovals = sourceRemovals
          .filter((removal) => normalizeMonth(removal.month) === month)
          .reduce((sum, removal) => sum + normalizeAmount(removal.amount), 0)
        const eventSurplus = eventIncome - eventExpenses
        const bankMovement = grossIncome - developmentExpenses - eventExpenses - customRemovals

        return {
          month,
          year,
          monthlyCollected,
          creditsApplied,
          monthlyCash,
          admissionCollected,
          dressRevenue,
          dressCost,
          dressProfit,
          extraIncome,
          eventIncome,
          grossIncome,
          developmentAllocation,
          developmentExpenses,
          eventExpenses,
          customRemovals,
          eventSurplus,
          eventDeposits,
          bankMovement,
          cumulativeBank: 0,
          cumulativeDevelopmentFund: 0,
        }
      })

      let cumulativeBank = 0
      let cumulativeDevelopmentFund = 0
      for (const row of breakdown) {
        cumulativeBank += row.bankMovement
        cumulativeDevelopmentFund += row.developmentAllocation - row.developmentExpenses
        row.cumulativeBank = cumulativeBank
        row.cumulativeDevelopmentFund = cumulativeDevelopmentFund
      }

      return breakdown
    }

    const monthlyBreakdown = buildFinanceBreakdown(
      targetYear,
      ledger.entries,
      relevantExpenses,
      relevantIncomes,
      relevantEventExpenses,
      relevantEventDeposits,
      relevantRemovals
    )

    const visibleBreakdown = monthlyBreakdown.filter((row) => withinMonthLimit(row.month, monthLimit))
    const totals = visibleBreakdown.reduce(
      (sum, row) => ({
        monthlyCollected: sum.monthlyCollected + row.monthlyCollected,
        creditsApplied: sum.creditsApplied + row.creditsApplied,
        monthlyCash: sum.monthlyCash + row.monthlyCash,
        admissionCollected: sum.admissionCollected + row.admissionCollected,
        dressRevenue: sum.dressRevenue + row.dressRevenue,
        dressCost: sum.dressCost + row.dressCost,
        dressProfit: sum.dressProfit + row.dressProfit,
        extraIncome: sum.extraIncome + row.extraIncome,
        eventIncome: sum.eventIncome + row.eventIncome,
        grossIncome: sum.grossIncome + row.grossIncome,
        developmentAllocation: sum.developmentAllocation + row.developmentAllocation,
        developmentExpenses: sum.developmentExpenses + row.developmentExpenses,
        eventExpenses: sum.eventExpenses + row.eventExpenses,
        customRemovals: sum.customRemovals + row.customRemovals,
        eventSurplus: sum.eventSurplus + row.eventSurplus,
        eventDeposits: sum.eventDeposits + row.eventDeposits,
        calculatedBankPosition: sum.calculatedBankPosition + row.bankMovement,
      }),
      {
        monthlyCollected: 0,
        creditsApplied: 0,
        monthlyCash: 0,
        admissionCollected: 0,
        dressRevenue: 0,
        dressCost: 0,
        dressProfit: 0,
        extraIncome: 0,
        eventIncome: 0,
        grossIncome: 0,
        developmentAllocation: 0,
        developmentExpenses: 0,
        eventExpenses: 0,
        customRemovals: 0,
        eventSurplus: 0,
        eventDeposits: 0,
        calculatedBankPosition: 0,
      }
    )
    let previousYearBreakdown: typeof visibleBreakdown = []
    let yearComparison: {
      previousYear: number
      monthlyCashGrowth: number
      bankMovementGrowth: number
      monthlyCashGrowthPercent: number | null
      bankMovementGrowthPercent: number | null
    } | null = null

    if (query.comparePrevious) {
      const previousYear = targetYear - 1
      const [
        previousLedger,
        previousExpenseRows,
        previousIncomeRows,
        previousEventExpenseRows,
        previousEventDepositRows,
        { data: previousRemovalRows, error: previousRemovalError },
      ] = await Promise.all([
        this.getLedger(session, {
          year: previousYear,
          city: 'bangalore',
          branch: query.branch,
          feeType: 'all',
          search: query.search,
        }),
        supabaseAdmin
          .from('development_fund_expenses')
          .select('*')
          .eq('year', previousYear)
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
        supabaseAdmin
          .from('fee_extra_incomes')
          .select('*')
          .eq('year', previousYear)
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
        supabaseAdmin
          .from('event_fee_expenses')
          .select('*')
          .gte('expense_date', `${previousYear}-01-01`)
          .lte('expense_date', `${previousYear}-12-31`)
          .is('deleted_at', null)
          .order('expense_date', { ascending: false }),
        supabaseAdmin
          .from('event_fee_deposits')
          .select('*')
          .gte('deposit_date', `${previousYear}-01-01`)
          .lte('deposit_date', `${previousYear}-12-31`)
          .is('deleted_at', null)
          .order('deposit_date', { ascending: false }),
        supabaseAdmin
          .from('fee_removals')
          .select('*')
          .eq('year', previousYear)
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
      ])
      if (previousExpenseRows.error) throwFeeDatabaseError(previousExpenseRows.error)
      if (previousIncomeRows.error && !isOptionalWorkflowSchemaError(previousIncomeRows.error)) throwFeeDatabaseError(previousIncomeRows.error)
      if (previousEventExpenseRows.error && !isOptionalWorkflowSchemaError(previousEventExpenseRows.error)) throwFeeDatabaseError(previousEventExpenseRows.error)
      if (previousEventDepositRows.error && !isOptionalWorkflowSchemaError(previousEventDepositRows.error)) throwFeeDatabaseError(previousEventDepositRows.error)
      if (previousRemovalError && !isOptionalWorkflowSchemaError(previousRemovalError)) throwFeeDatabaseError(previousRemovalError)
      const previousExpenses = (previousExpenseRows.data || [])
        .filter((expense) => expenseMatchesLocation(expense.scope, 'bangalore', query.branch))
        .filter((expense) => withinMonthLimit(normalizeMonth(expense.month), monthLimit))
      const previousIncomes = (previousIncomeRows.data || [])
        .filter((income) => expenseMatchesLocation(income.scope, 'bangalore', query.branch))
        .filter((income) => withinMonthLimit(normalizeMonth(income.month), monthLimit))
      const previousEventExpenses = (previousEventExpenseRows.data || [])
        .filter((expense) => expenseMatchesLocation(expense.branch_scope, 'bangalore', query.branch))
        .filter((expense) => withinMonthLimit(monthFromDateValue(expense.expense_date), monthLimit))
      const previousEventDeposits = (previousEventDepositRows.data || [])
        .filter((deposit) => expenseMatchesLocation(deposit.branch_scope, 'bangalore', query.branch))
        .filter((deposit) => withinMonthLimit(monthFromDateValue(deposit.deposit_date), monthLimit))
      const previousRemovals = (previousRemovalRows || [])
        .filter((removal) => expenseMatchesLocation(removal.scope, 'bangalore', query.branch))
        .filter((removal) => withinMonthLimit(normalizeMonth(removal.month), monthLimit))
      previousYearBreakdown = buildFinanceBreakdown(
        previousYear,
        previousLedger.entries,
        previousExpenses,
        previousIncomes,
        previousEventExpenses,
        previousEventDeposits,
        previousRemovals
      )
        .filter((row) => withinMonthLimit(row.month, monthLimit))

      const previousTotals = previousYearBreakdown.reduce(
        (sum, row) => ({
          monthlyCash: sum.monthlyCash + row.monthlyCash,
          bankMovement: sum.bankMovement + row.bankMovement,
        }),
        { monthlyCash: 0, bankMovement: 0 }
      )
      const monthlyCashGrowth = totals.monthlyCash - previousTotals.monthlyCash
      const bankMovementGrowth = totals.calculatedBankPosition - previousTotals.bankMovement
      yearComparison = {
        previousYear,
        monthlyCashGrowth,
        bankMovementGrowth,
        monthlyCashGrowthPercent: previousTotals.monthlyCash
          ? Math.round((monthlyCashGrowth / previousTotals.monthlyCash) * 100)
          : null,
        bankMovementGrowthPercent: previousTotals.bankMovement
          ? Math.round((bankMovementGrowth / previousTotals.bankMovement) * 100)
          : null,
      }
    }

    const reserveAmount = String(query.branch || '').trim() ? 0 : BANGALORE_OPENING_RESERVE
    const actualBankBalance = totals.calculatedBankPosition + reserveAmount

    return {
      restricted: false,
      city: 'Bangalore',
      branch: query.branch || '',
      period: { year: targetYear, month: targetMonth || 'All', label: periodLabel },
      citySummary: ledger.citySummary,
      branchSummary: ledger.branchSummary,
      bankPosition: {
        ...totals,
        reserveAmount,
        actualBankBalance,
        developmentFundBalance:
          totals.developmentAllocation - totals.developmentExpenses,
        formula:
          'Opening reserve + monthly fee cash after credits + admission collected + dress profit + extra income + event income - development expenses - event expenses - custom removals',
      },
      monthlyBreakdown: visibleBreakdown,
      previousYearBreakdown,
      yearComparison,
      expenses: relevantExpenses,
      extraIncomes: relevantIncomes,
      eventExpenses: relevantEventExpenses,
      eventDeposits: relevantEventDeposits,
      removals: relevantRemovals,
      dataQuality: await this.getDataQuality(session, { ...query, city: 'bangalore', year: targetYear, month: targetMonth || query.month }),
    }
  }

  static async getDataQuality(session: Session, query: FeeConsoleQueryInput) {
    requireFeeDatabase()
    const { targetYear, targetMonth } = periodLimit(query)
    const month = targetMonth || normalizeMonth(query.month || currentPeriod().month)
    const branchFilter = String(query.branch || '').trim()

    const [athletes, monthlyRows, paidRows, proofRows, expenseRows, billingProfileRows] = await Promise.all([
      getAllAthletesLive() as Promise<AthleteRecord[]>,
      getFeeRows({ year: targetYear, month, feeType: 'monthly' }),
      getFeeRows({ year: targetYear, status: 'paid' }),
      supabaseAdmin
        .from('fee_payment_proofs')
        .select('*')
        .eq('status', 'submitted')
        .order('submitted_at', { ascending: true })
        .limit(200),
      supabaseAdmin
        .from('development_fund_expenses')
        .select('*')
        .eq('year', targetYear)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }),
      supabaseAdmin
        .from('student_billing_profiles')
        .select('skf_id, monthly_fee'),
    ])

    if (proofRows.error) throwFeeDatabaseError(proofRows.error)
    if (expenseRows.error) throwFeeDatabaseError(expenseRows.error)
    if (billingProfileRows.error) throwFeeDatabaseError(billingProfileRows.error)

    const rowBySkfId = new Map(monthlyRows.map((row) => [row.skf_id, row]))
    const activeAthletes = athletes
      .filter((athlete) => String(athlete.status || 'active').toLowerCase() === 'active')
      .filter((athlete) => canSeeBranch(session, athlete.branchName))
      .filter((athlete) => branchMatchesCity(athlete.branchName, query.city))
      .filter((athlete) => branchMatchesFilter(athlete.branchName, branchFilter))

    const missingBranch = activeAthletes.filter((athlete) => !String(athlete.branchName || '').trim())
    const unmappedCity = activeAthletes.filter((athlete) => {
      const branch = String(athlete.branchName || '').trim()
      return Boolean(branch) && !cityForBranch(branch)
    })
    const missingMonthlyRows = activeAthletes.filter((athlete) => {
      const skfId = normaliseSkfId(String(athlete.skfId || ''))
      return Boolean(skfId) && !rowBySkfId.has(skfId)
    })
    const zeroMonthlyFees = activeAthletes.filter((athlete) => {
      const skfId = normaliseSkfId(String(athlete.skfId || ''))
      const row = rowBySkfId.get(skfId)
      return normalizeAmount(row?.amount ?? athlete.monthlyFee) <= 0
    })
    const billingBySkfId = new Map(
      (billingProfileRows.data || []).map((profile) => [
        normaliseSkfId(String(profile.skf_id || '')),
        normalizeAmount(profile.monthly_fee),
      ])
    )
    const feeAmountMismatch = activeAthletes
      .map((athlete) => {
        const skfId = normaliseSkfId(String(athlete.skfId || ''))
        const row = rowBySkfId.get(skfId)
        const expected = billingBySkfId.get(skfId) ?? normalizeAmount(athlete.monthlyFee)
        return { athlete, row, expected }
      })
      .filter(({ row, expected }) =>
        row &&
        row.status === 'due' &&
        Math.abs(normalizeAmount(row.amount) - expected) > 1
      )

    const athleteBySkfId = new Map(
      athletes.map((athlete) => [normaliseSkfId(String(athlete.skfId || '')), athlete])
    )

    const paidWithoutReceipts = paidRows
      .filter((row) => row.fee_type !== 'credit_adjustment')
      .filter((row) => !String(row.receipt_id || '').trim())
      .map((row) => ({ row, athlete: athleteBySkfId.get(row.skf_id) }))
      .filter(({ athlete }) => canSeeBranch(session, athlete?.branchName))
      .filter(({ athlete }) => branchMatchesCity(athlete?.branchName, query.city))
      .filter(({ athlete }) => branchMatchesFilter(athlete?.branchName, branchFilter))

    const staleProofCutoff = Date.now() - 48 * 60 * 60 * 1000
    const stalePaymentProofs = ((proofRows.data || []) as PaymentProofRow[])
      .map((proof) => ({ proof, athlete: athleteBySkfId.get(normaliseSkfId(proof.skf_id)) }))
      .filter(({ proof }) => new Date(proof.submitted_at).getTime() < staleProofCutoff)
      .filter(({ athlete }) => canSeeBranch(session, athlete?.branchName))
      .filter(({ athlete }) => branchMatchesCity(athlete?.branchName, query.city))
      .filter(({ athlete }) => branchMatchesFilter(athlete?.branchName, branchFilter))

    const unclearExpenseScopes = (expenseRows.data || [])
      .filter((expense) => !hasKnownExpenseScope(expense.scope))

    const issues = [
      {
        type: 'missing_branch',
        severity: 'high',
        title: 'Active students without a branch',
        count: missingBranch.length,
        examples: compactIssueExamples(missingBranch, (athlete) => ({
          skfId: athlete.skfId,
          name: athleteName(athlete),
        })),
      },
      {
        type: 'unmapped_city',
        severity: 'medium',
        title: 'Branches not mapped to a city card',
        count: unmappedCity.length,
        examples: compactIssueExamples(unmappedCity, (athlete) => ({
          skfId: athlete.skfId,
          name: athleteName(athlete),
          branch: athlete.branchName,
        })),
      },
      {
        type: 'missing_monthly_rows',
        severity: 'high',
        title: `Missing monthly rows for ${month} ${targetYear}`,
        count: missingMonthlyRows.length,
        examples: compactIssueExamples(missingMonthlyRows, (athlete) => ({
          skfId: athlete.skfId,
          name: athleteName(athlete),
          branch: athlete.branchName,
        })),
      },
      {
        type: 'zero_monthly_fee',
        severity: 'medium',
        title: 'Active students with zero monthly fee',
        count: zeroMonthlyFees.length,
        examples: compactIssueExamples(zeroMonthlyFees, (athlete) => ({
          skfId: athlete.skfId,
          name: athleteName(athlete),
          branch: athlete.branchName,
        })),
      },
      {
        type: 'paid_without_receipt',
        severity: 'high',
        title: 'Paid rows without receipt IDs',
        count: paidWithoutReceipts.length,
        examples: compactIssueExamples(paidWithoutReceipts, ({ row, athlete }) => ({
          skfId: row.skf_id,
          name: athleteName(athlete),
          period: `${row.month} ${row.year}`,
          feeType: row.fee_type,
        })),
      },
      {
        type: 'fee_amount_mismatch',
        severity: 'medium',
        title: 'Due rows not matching billing profile amount',
        count: feeAmountMismatch.length,
        examples: compactIssueExamples(feeAmountMismatch, ({ row, athlete, expected }) => ({
          skfId: row?.skf_id,
          name: athleteName(athlete),
          current: row?.amount,
          expected,
        })),
      },
      {
        type: 'stale_payment_proofs',
        severity: 'medium',
        title: 'Payment proofs waiting over 48 hours',
        count: stalePaymentProofs.length,
        examples: compactIssueExamples(stalePaymentProofs, ({ proof, athlete }) => ({
          skfId: proof.skf_id,
          name: athleteName(athlete),
          submittedAt: proof.submitted_at,
          amount: proof.amount,
        })),
      },
      {
        type: 'unclear_expense_scope',
        severity: 'medium',
        title: 'Development expenses with unclear scope',
        count: unclearExpenseScopes.length,
        examples: compactIssueExamples(unclearExpenseScopes, (expense) => ({
          title: expense.title,
          scope: expense.scope,
          amount: expense.amount,
        })),
      },
    ]

    if (missingMonthlyRows.length) {
      await notifyMissingMonthlyRows({
        month,
        year: targetYear,
        count: missingMonthlyRows.length,
        city: query.city,
        branch: query.branch,
        examples: missingMonthlyRows.map((athlete) => ({
          skfId: athlete.skfId,
          name: athleteName(athlete),
          branch: athlete.branchName,
        })),
      })
    }

    return {
      period: { month, year: targetYear },
      totalIssues: issues.reduce((sum, issue) => sum + issue.count, 0),
      counts: Object.fromEntries(issues.map((issue) => [issue.type, issue.count])),
      issues,
    }
  }

  private static buildReconciliation(studentData: Record<string, unknown>, dataQuality: Record<string, unknown>) {
    const issueByType = new Map(
      ((dataQuality?.issues || []) as Array<Record<string, unknown>>).map((issue) => [String(issue.type || ''), issue])
    )
    const groups: Array<Record<string, unknown>> = []
    const issueGroups: Array<{
      type: string
      actionLabel?: string
      action?: string
      route?: string
    }> = [
        { type: 'missing_monthly_rows', actionLabel: 'Sync rows', action: 'sync_missing_monthly_rows' },
        { type: 'paid_without_receipt', actionLabel: 'Generate receipts', action: 'generate_missing_receipts' },
        { type: 'fee_amount_mismatch', actionLabel: 'Reconcile amounts', action: 'reconcile_due_amounts' },
        { type: 'stale_payment_proofs', actionLabel: 'Review proofs', route: '/fee/payments?status=pending_verification' },
        { type: 'unclear_expense_scope', actionLabel: 'Review fund', route: '/fee/development-fund' },
        { type: 'missing_branch', actionLabel: 'Fix students', route: '/students/all' },
        { type: 'unmapped_city', actionLabel: 'Map branch', route: '/students/all' },
        { type: 'zero_monthly_fee', actionLabel: 'Open students', route: '/fee/students' },
      ]

    for (const config of issueGroups) {
      const issue = issueByType.get(config.type)
      const count = Number(issue?.count || 0)
      if (!issue || count <= 0) continue
      groups.push({
        type: config.type,
        severity: issue.severity || 'medium',
        title: issue.title || config.type.replace(/_/g, ' '),
        count,
        actionLabel: config.actionLabel || 'Review',
        action: config.action || null,
        route: config.route || null,
        items: issue.examples || [],
      })
    }

    const filters = (studentData?.filters || {}) as Record<string, unknown>
    const qualityPeriod = (dataQuality?.period || {}) as Record<string, unknown>
    const overdueWithoutContact = ((studentData?.students || []) as Array<Record<string, unknown>>)
      .filter((student) => ['overdue', 'rejected'].includes(String(student.status || '')))
      .filter((student) => !student.latestFollowup)
      .slice(0, 12)
      .map((student) => ({
        skfId: student.skfId,
        feeRecordId: student.feeRecordId,
        feeType: 'monthly',
        month: filters.month || qualityPeriod.month || currentPeriod().month,
        year: filters.year || qualityPeriod.year || currentPeriod().year,
        name: student.name,
        branch: student.branch,
        amount: student.amount,
        status: student.status,
      }))

    if (overdueWithoutContact.length) {
      groups.push({
        type: 'overdue_without_contact',
        severity: 'high',
        title: 'Overdue students without contact log',
        count: overdueWithoutContact.length,
        actionLabel: 'Send reminder',
        action: 'send_whatsapp_reminder',
        route: null,
        items: overdueWithoutContact,
      })
    }

    const severityRank: Record<string, number> = { high: 0, medium: 1, low: 2 }
    groups.sort((a, b) =>
      (severityRank[String(a.severity || 'medium')] ?? 1) - (severityRank[String(b.severity || 'medium')] ?? 1) ||
      String(a.title || '').localeCompare(String(b.title || ''))
    )

    return {
      period: dataQuality?.period || studentData?.filters || {},
      totalOpen: groups.reduce((sum, group) => sum + Number(group.count || 0), 0),
      highCount: groups
        .filter((group) => group.severity === 'high')
        .reduce((sum, group) => sum + Number(group.count || 0), 0),
      groups,
    }
  }

  static async getReconciliation(session: Session, query: FeeConsoleQueryInput) {
    const [studentData, dataQuality] = await Promise.all([
      this.getStudents(session, query),
      this.getDataQuality(session, query),
    ])
    return this.buildReconciliation(studentData, dataQuality)
  }

  static async getLedger(session: Session, query: FeeConsoleQueryInput) {
    const targetYear = Number(query.year || currentPeriod().year)
    const rows = await getFeeRows({
      year: targetYear,
      month: query.month ? normalizeMonth(query.month) : undefined,
      status: query.status,
      feeType: query.feeType,
    })
    const athletes = (await getAllAthletesLive()) as AthleteRecord[]
    const athleteBySkfId = new Map(athletes.map((athlete) => [normaliseSkfId(String(athlete.skfId || '')), athlete]))
    const branchFilter = String(query.branch || '').trim()
    const search = String(query.search || '').trim().toLowerCase()

    const visibleEntries = rows
      .map((row) => rowToEntry(row, athleteBySkfId.get(row.skf_id)))
      .filter((entry) => canSeeBranch(session, entry.branch))
      .filter((entry) => branchMatchesCity(entry.branch, query.city))
      .filter((entry) => {
        if (!search) return true
        return (
          entry.skfId.toLowerCase().includes(search) ||
          entry.athleteName.toLowerCase().includes(search) ||
          entry.branch.toLowerCase().includes(search)
        )
      })
    const citySummary = buildCitySummary(visibleEntries)
    const branchSummary = buildBranchSummary(visibleEntries)
    const entries = visibleEntries
      .filter((entry) => branchMatchesFilter(entry.branch, branchFilter))
      .sort((a, b) => (b.year - a.year) || (b.monthIndex - a.monthIndex) || a.athleteName.localeCompare(b.athleteName))

    const creditRows = entries.filter((entry) => entry.feeType === 'credit_adjustment' || entry.amount < 0)
    const paged = paginateItems(entries, query)

    return {
      filters: query,
      summary: {
        totalRows: entries.length,
        totalExpected: entries
          .filter((row) => row.feeType !== 'credit_adjustment' && !nonBillableStatus(row.status))
          .reduce((sum, row) => sum + row.amount, 0),
        totalPaid: entries.filter((row) => row.status === 'paid' && row.feeType !== 'credit_adjustment').reduce((sum, row) => sum + row.amount, 0),
        totalDue: entries.filter((row) => outstandingStatus(row.status)).reduce((sum, row) => sum + row.amount, 0),
        creditsUsed: Math.abs(creditRows.filter((row) => row.status === 'paid').reduce((sum, row) => sum + row.amount, 0)),
        paidCount: entries.filter((row) => row.status === 'paid').length,
        dueCount: entries.filter((row) => row.status === 'due').length,
        overdueCount: entries.filter((row) => row.status === 'overdue').length,
        pendingVerificationCount: entries.filter((row) => row.status === 'pending_verification').length,
        breakCount: entries.filter((row) => row.status === 'break').length,
        waivedCount: entries.filter((row) => row.status === 'waived').length,
        rejectedCount: entries.filter((row) => row.status === 'rejected').length,
      },
      citySummary,
      branchSummary,
      entries: paged.items,
      pagination: paged.pagination,
    }
  }

  static async getStudent(session: Session, skfId: string, year?: number) {
    const normalizedSkfId = normaliseSkfId(skfId)
    const athlete = await assertCanAccessSkfId(session, normalizedSkfId)
    const [billingProfile, rows, auditRows, followupRows] = await Promise.all([
      getBillingProfile(normalizedSkfId),
      getFeeRows({ skfId: normalizedSkfId, year: Number(year || currentPeriod().year) }),
      supabaseAdmin
        .from('fee_audit_logs')
        .select('id, actor_name, actor_role, action, fee_record_id, metadata, created_at')
        .eq('skf_id', normalizedSkfId)
        .order('created_at', { ascending: false })
        .limit(10),
      supabaseAdmin
        .from('fee_followups')
        .select('id, skf_id, fee_type, month, year, contacted_by, contacted_by_role, contact_method, note, created_at')
        .eq('skf_id', normalizedSkfId)
        .eq('year', Number(year || currentPeriod().year))
        .order('created_at', { ascending: false })
        .limit(20),
    ])
    if (auditRows.error) throwFeeDatabaseError(auditRows.error)
    if (followupRows.error) throwFeeDatabaseError(followupRows.error)
    let reminderRows: Array<Record<string, unknown>> = []
    const reminders = await supabaseAdmin
      .from('fee_reminder_logs')
      .select('id, skf_id, fee_record_id, fee_type, month, year, amount, channel, template_key, recipient_name, recipient_phone, message_url, status, sent_by, sent_at, created_at')
      .eq('skf_id', normalizedSkfId)
      .eq('year', Number(year || currentPeriod().year))
      .order('created_at', { ascending: false })
      .limit(20)
    if (reminders.error) {
      if (!isOptionalWorkflowSchemaError(reminders.error)) throwFeeDatabaseError(reminders.error)
    } else {
      reminderRows = (reminders.data || []) as Array<Record<string, unknown>>
    }

    return {
      profile: {
        skfId: normalizedSkfId,
        name: athleteName(athlete),
        branch: athlete.branchName || '',
        ...cityLabelForBranch(athlete.branchName),
        parentName: athlete.parentName || '',
        phone: athlete.phone || '',
        email: athlete.email || '',
        joinDate: athlete.joinDate || '',
      },
      billingProfile: billingProfile || {
        skf_id: normalizedSkfId,
        billing_status: 'active',
        monthly_fee: normalizeAmount(athlete.monthlyFee),
        admission_fee: 0,
        dress_fee: 0,
        dress_cost: 0,
        billing_start_date: athlete.joinDate || null,
        branch_snapshot: athlete.branchName || null,
      },
      entries: rows.map((row) => rowToEntry(row, athlete)),
      auditTrail: (auditRows.data || []).map((row) => ({
        id: row.id,
        actorName: row.actor_name || 'System',
        actorRole: row.actor_role || '',
        action: row.action,
        feeRecordId: row.fee_record_id,
        metadata: row.metadata || {},
        createdAt: row.created_at,
      })),
      followups: (followupRows.data || []).map((row) => ({
        id: row.id,
        skfId: row.skf_id,
        feeType: row.fee_type,
        month: row.month,
        year: row.year,
        contactedBy: row.contacted_by,
        contactedByRole: row.contacted_by_role,
        contactMethod: row.contact_method,
        note: row.note,
        createdAt: row.created_at,
      })),
      reminders: reminderRows.map((row) => ({
        id: row.id,
        skfId: row.skf_id,
        feeRecordId: row.fee_record_id,
        feeType: row.fee_type,
        month: row.month,
        year: row.year,
        amount: normalizeAmount(row.amount),
        channel: row.channel,
        templateKey: row.template_key,
        recipientName: row.recipient_name,
        recipientPhone: row.recipient_phone,
        messageUrl: row.message_url,
        status: row.status,
        sentBy: row.sent_by,
        sentAt: row.sent_at,
        createdAt: row.created_at,
      })),
    }
  }

  static async updateBilling(session: Session, skfId: string, updates: Record<string, unknown>) {
    assertWrite(session)
    const athlete = await assertCanAccessSkfId(session, skfId)
    const before = await getBillingProfile(skfId)
    const after = await upsertBillingProfileFromAthlete(athlete, updates)
    await logAudit(session, { action: 'billing_profile_updated', skfId, before, after })
    return after
  }

  static async runLedgerAction(session: Session, input: FeeConsoleLedgerActionInput) {
    assertWrite(session)
    const targetYear = 'year' in input && input.year ? Number(input.year) : currentPeriod().year

    if (input.action === 'sync_all') {
      const athletes = (await getAllAthletesLive()) as AthleteRecord[]
      let synced = 0
      for (const athlete of athletes) {
        if (String(athlete.status || '').toLowerCase() !== 'active') continue
        if (!canSeeBranch(session, athlete.branchName)) continue
        await this.syncStudent(session, normaliseSkfId(String(athlete.skfId || '')), targetYear)
        synced += 1
      }
      await logAudit(session, { action: 'sync_all_fee_rows', metadata: { year: targetYear, synced } })
      return { success: true, synced, year: targetYear }
    }

    const skfId = normaliseSkfId(input.skfId)
    const athlete = await assertCanAccessSkfId(session, skfId)

    if (input.action === 'sync_student') {
      return this.syncStudent(session, skfId, targetYear)
    }

    if (input.action === 'resume_billing') {
      const month = normalizeMonth(input.month)
      const resumeValue = periodValue(targetYear, month)
      const before = await getBillingProfile(skfId)
      const existingFee = normalizeAmount(before?.monthly_fee ?? athlete.monthlyFee)
      const monthlyFee = normalizeAmount(input.monthlyFee) > 0
        ? normalizeAmount(input.monthlyFee)
        : existingFee
      const reason = input.reason || 'Student resumed billing; fee tracking restarted from selected month.'

      const after = await this.updateBilling(session, skfId, {
        billing_status: 'active',
        billing_end_date: null,
        billing_start_date: String(before?.billing_start_date || athlete.joinDate || '').trim() || null,
        monthly_fee: monthlyFee,
        notes: reason,
      })

      // Restore athlete portal access alongside billing (discontinued flips it off).
      await setAthletePortalStatus(skfId, 'active')

      const synced = await ensureFeeRowsForStudent(skfId, {
        monthlyFee,
        enrolledDate: periodStartDate(targetYear, month),
        year: targetYear,
        overwriteAmount: true,
      })

      const monthlyRows = await getFeeRows({ skfId, feeType: 'monthly' })
      const rowsToResume = monthlyRows.filter((row) =>
        ['break', 'waived'].includes(row.status) &&
        periodValue(row.year, row.month) >= resumeValue
      )

      for (const row of rowsToResume) {
        const { error } = await supabaseAdmin
          .from('fee_records')
          .update({
            status: 'due',
            amount: monthlyFee,
            paid_date: null,
            receipt_id: null,
            payment_method: null,
            verified_by: null,
            verified_at: null,
            rejected_reason: null,
            notes: reason,
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id)
        if (error) throwFeeDatabaseError(error)
      }

      await logAudit(session, {
        action: 'fee_student_billing_resumed',
        skfId,
        metadata: {
          resumePeriod: periodStartDate(targetYear, month),
          monthlyFee,
          restoredRows: rowsToResume.length,
          synced,
        },
      })

      return {
        success: true,
        skfId,
        billingProfile: after,
        resumeMonth: month,
        resumeYear: targetYear,
        monthlyFee,
        restoredRows: rowsToResume.length,
        synced,
      }
    }

    if (input.action === 'mark_discontinued') {
      const month = normalizeMonth(input.month || currentPeriod().month)
      const monthlyRows = await getFeeRows({ skfId, feeType: 'monthly' })
      const latestPaidValue = monthlyRows
        .filter((row) => row.status === 'paid')
        .reduce((latest, row) => Math.max(latest, periodValue(row.year, row.month)), -1)
      const selectedValue = periodValue(targetYear, month)
      const stopValue = Math.max(latestPaidValue, selectedValue)
      const after = await this.updateBilling(session, skfId, {
        billing_status: 'discontinued',
        billing_end_date: stopValue >= 0 ? periodEndDate(stopValue) : null,
        notes: input.reason || null,
      })

      const rowsToWaive = monthlyRows.filter((row) =>
        row.status !== 'paid' &&
        periodValue(row.year, row.month) >= stopValue
      )
      for (const row of rowsToWaive) {
        const { error } = await supabaseAdmin
          .from('fee_records')
          .update({
            status: 'waived',
            paid_date: null,
            receipt_id: null,
            payment_method: null,
            verified_by: null,
            verified_at: null,
            notes: input.reason || 'Student discontinued; billing stopped after last paid period.',
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id)
        if (error) throwFeeDatabaseError(error)
      }

      // Discontinued students lose athlete-portal access; resume_billing restores it.
      await setAthletePortalStatus(skfId, 'inactive')

      await logAudit(session, {
        action: 'fee_student_discontinued_tracking_stopped',
        skfId,
        metadata: {
          stopPeriod: stopValue >= 0 ? periodEndDate(stopValue) : null,
          waivedRows: rowsToWaive.length,
        },
      })
      return after
    }

    if (input.action === 'apply_credit') {
      requireFeeDatabase()
      const month = normalizeMonth(input.month)
      const feeType = input.feeType || 'monthly'
      const { data: creditResult, error: creditError } = await supabaseAdmin.rpc('apply_fee_credit', {
        p_credit_id: input.creditId,
        p_skf_id: skfId,
        p_month: month,
        p_year: targetYear,
        p_fee_type: feeType,
        p_actor: actorName(session),
      })
      if (creditError) throwFeeDatabaseError(creditError)

      const creditPayload = creditResult as {
        credit?: Record<string, unknown>
        adjustment?: Record<string, unknown>
      } | null
      const credit = creditPayload?.credit
      const adjustment = creditPayload?.adjustment
      if (!credit || !adjustment) throw new NotFoundError('Credit')

      const amount = normalizeAmount(credit.amount)
      const adjustmentRow = normalizeFeeRecord(adjustment)
      const existingCreditRows = await getFeeRows({
        skfId,
        feeType: 'credit_adjustment',
        month,
        year: targetYear,
      })
      const existingCreditAmount = existingCreditRows.reduce((sum, row) => sum + normalizeAmount(row.amount), 0)
      const now = new Date().toISOString()
      const targetRows = await getFeeRows({ skfId, feeType, month, year: targetYear })
      const billingProfile = targetRows[0] ? null : await getBillingProfile(skfId)
      const defaultTargetAmount =
        feeType === 'admission'
          ? normalizeAmount(billingProfile?.admission_fee)
          : feeType === 'dress'
            ? normalizeAmount(billingProfile?.dress_fee)
            : normalizeAmount(athlete.monthlyFee)
      const targetRow = targetRows[0] || await ensureFeeRecord({
        skfId,
        feeType,
        month,
        year: targetYear,
        amount: defaultTargetAmount,
        metadata: feeType === 'dress' ? { dressCost: normalizeAmount(billingProfile?.dress_cost) } : undefined,
      })
      let updatedTarget = targetRow
      if (existingCreditAmount >= normalizeAmount(targetRow.amount)) {
        const receiptId = receiptIdForPaidFee(targetRow, skfId, feeType, month, targetYear)
        const { data, error } = await supabaseAdmin
          .from('fee_records')
          .update({
            status: 'paid',
            paid_date: now,
            receipt_id: receiptId,
            payment_method: 'credit adjustment',
            verified_by: actorName(session),
            verified_at: now,
            notes: 'Paid fully using fee credit.',
            updated_at: now,
          })
          .eq('id', targetRow.id)
          .select('*')
          .single()
        if (error) throwFeeDatabaseError(error)
        updatedTarget = normalizeFeeRecord(data)
        await ensureReceiptForPaidRow({ row: updatedTarget, athlete, issuedAt: now })
      }

      await logAudit(session, {
        action: 'fee_credit_applied',
        skfId,
        feeRecordId: adjustmentRow.id,
        before: credit,
        after: adjustmentRow,
        metadata: { creditId: input.creditId, month, year: targetYear, targetFeeRecordId: updatedTarget.id },
      })
      notifyTreasuryAction('Fee Credit Applied', [
        `*Student:* ${athleteName(athlete)} (${skfId})`,
        `*Credit:* ₹${amount}`,
        `*Applied To:* ${formatFeeTypeLabel(feeType)} / ${month} ${targetYear}`,
        `*Applied By:* ${actorName(session)}`
      ]).catch(err => logger.warn('fee.notify_treasury_action_failed', { err }))
      return {
        success: true,
        creditId: input.creditId,
        creditAmount: amount,
        adjustment: rowToEntry(adjustmentRow, athlete),
        target: rowToEntry(updatedTarget, athlete),
      }
    }

    const feeType = 'feeType' in input ? input.feeType : 'monthly'
    const month = 'month' in input ? normalizeMonth(input.month) : currentPeriod().month
    const explicitAmount = 'amount' in input ? input.amount : undefined
    const hasExplicitAmount = explicitAmount !== undefined
    const feeRecordId = 'feeRecordId' in input ? input.feeRecordId : undefined
    const existingRows = feeRecordId
      ? await getFeeRows({ skfId, feeRecordId })
      : hasExplicitAmount
        ? []
        : await getFeeRows({ skfId, feeType, month, year: targetYear })
    const existingRow = existingRows[0] || null
    const billingProfile = existingRow ? null : await getBillingProfile(skfId)
    const amount = hasExplicitAmount
      ? normalizeAmount(explicitAmount)
      : existingRow
        ? normalizeAmount(existingRow.amount)
        : billingProfileAmount(feeType, athlete, billingProfile)
    const row = existingRow || await ensureFeeRecord({
      skfId,
      feeType,
      month,
      year: targetYear,
      amount,
      metadata: billingProfileMetadata(feeType, billingProfile),
    })
    const before = row

    if (input.action === 'mark_paid') {
      const paymentMethod = [input.paymentMethod || 'manual', input.paymentReference || ''].filter(Boolean).join(' - ')
      const receiptId = receiptIdForPaidFee(row, skfId, feeType, month, targetYear)
      const now = new Date().toISOString()
      const { data, error } = await supabaseAdmin
        .from('fee_records')
        .update({
          status: 'paid',
          amount,
          paid_date: now,
          receipt_id: receiptId,
          payment_method: paymentMethod,
          verified_by: actorName(session),
          verified_at: now,
          rejected_reason: null,
          notes: input.notes || null,
          updated_at: now,
        })
        .eq('id', row.id)
        .select('*')
        .single()
      if (error) throwFeeDatabaseError(error)
      const after = normalizeFeeRecord(data)
      const receipt = await ensureReceiptForPaidRow({ row: after, athlete, issuedAt: now })
      await logAudit(session, { action: 'fee_marked_paid', skfId, feeRecordId: row.id, before, after })
      notifyTreasuryAction('Manual Payment Recorded', [
        `*Student:* ${athleteName(athlete)} (${skfId})`,
        `*Fee:* ${formatFeeTypeLabel(feeType)} / ${month} ${targetYear}`,
        `*Amount:* ₹${amount}`,
        `*Method:* ${paymentMethod}`,
        `*Recorded By:* ${actorName(session)}`
      ]).catch(err => logger.warn('fee.notify_treasury_action_failed', { err }))
      return { success: true, entry: rowToEntry(after, athlete), receipt }
    }

    const nextStatus =
      input.action === 'mark_due'
        ? 'due'
        : input.action === 'mark_break'
          ? 'break'
          : 'waived'
    await voidReceiptForRow(row, `Fee row changed from paid to ${nextStatus}.`)
    const { data, error } = await supabaseAdmin
      .from('fee_records')
      .update({
        status: nextStatus,
        paid_date: null,
        receipt_id: null,
        payment_method: null,
        verified_by: null,
        verified_at: null,
        rejected_reason: null,
        notes: 'reason' in input ? input.reason || null : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .select('*')
      .single()
    if (error) throwFeeDatabaseError(error)
    const after = normalizeFeeRecord(data)
    await logAudit(session, { action: `fee_marked_${nextStatus}`, skfId, feeRecordId: row.id, before, after })
    return { success: true, entry: rowToEntry(after, athlete) }
  }

  static async runBulkLedgerActions(session: Session, input: FeeConsoleBulkActionInput) {
    assertWrite(session)

    const results = []
    for (const action of input.actions) {
      const skfId = 'skfId' in action ? normaliseSkfId(action.skfId) : ''
      try {
        const result = await this.runLedgerAction(session, action)
        results.push({
          success: true,
          skfId,
          action: action.action,
          result,
        })
      } catch (error) {
        results.push({
          success: false,
          skfId,
          action: action.action,
          error: error instanceof Error ? error.message : 'Unable to complete fee action.',
        })
      }
    }

    const successCount = results.filter((result) => result.success).length
    return {
      success: true,
      successCount,
      failureCount: results.length - successCount,
      results,
    }
  }

  static async runDataQualityFix(session: Session, input: FeeDataQualityFixInput) {
    assertWrite(session)
    requireFeeDatabase()

    const period = currentPeriod()
    const year = Number(input.year || period.year)
    const month = normalizeMonth(input.month || period.month)
    const branchFilter = String(input.branch || '').trim()

    if (input.action === 'sync_missing_monthly_rows') {
      const [athletes, monthlyRows] = await Promise.all([
        getAllAthletesLive() as Promise<AthleteRecord[]>,
        getFeeRows({ year, month, feeType: 'monthly' }),
      ])
      const rowBySkfId = new Set(monthlyRows.map((row) => row.skf_id))
      const targets = athletes
        .filter((athlete) => String(athlete.status || 'active').toLowerCase() === 'active')
        .filter((athlete) => canSeeBranch(session, athlete.branchName))
        .filter((athlete) => branchMatchesCity(athlete.branchName, input.city))
        .filter((athlete) => branchMatchesFilter(athlete.branchName, branchFilter))
        .filter((athlete) => {
          const skfId = normaliseSkfId(String(athlete.skfId || ''))
          return Boolean(skfId) && !rowBySkfId.has(skfId)
        })

      let synced = 0
      for (const athlete of targets) {
        const skfId = normaliseSkfId(String(athlete.skfId || ''))
        await this.syncStudent(session, skfId, year)
        synced += 1
      }
      await logAudit(session, {
        action: 'data_quality_sync_missing_monthly_rows',
        metadata: { year, month, synced },
      })
      return { success: true, action: input.action, synced, year, month }
    }

    if (input.action === 'generate_missing_receipts') {
      const [paidRows, athletes] = await Promise.all([
        getFeeRows({ year, status: 'paid' }),
        getAllAthletesLive() as Promise<AthleteRecord[]>,
      ])
      const athleteBySkfId = new Map(athletes.map((athlete) => [normaliseSkfId(String(athlete.skfId || '')), athlete]))
      const targets = paidRows
        .filter((row) => row.fee_type !== 'credit_adjustment')
        .filter((row) => !String(row.receipt_id || '').trim())
        .map((row) => ({ row, athlete: athleteBySkfId.get(row.skf_id) }))
        .filter(({ athlete }) => canSeeBranch(session, athlete?.branchName))
        .filter(({ athlete }) => branchMatchesCity(athlete?.branchName, input.city))
        .filter(({ athlete }) => branchMatchesFilter(athlete?.branchName, branchFilter))

      let generated = 0
      for (const { row, athlete } of targets) {
        if (!athlete) continue
        await ensureReceiptForPaidRow({ row, athlete, issuedAt: row.verified_at || row.paid_date || undefined })
        await logAudit(session, {
          action: 'data_quality_receipt_generated',
          skfId: row.skf_id,
          feeRecordId: row.id,
          metadata: { year, month, feeType: row.fee_type },
        })
        generated += 1
      }
      return { success: true, action: input.action, generated, year, month }
    }

    const [athletes, billingProfiles, monthlyRows] = await Promise.all([
      getAllAthletesLive() as Promise<AthleteRecord[]>,
      supabaseAdmin.from('student_billing_profiles').select('skf_id, monthly_fee'),
      getFeeRows({ year, month, feeType: 'monthly' }),
    ])
    if (billingProfiles.error) throwFeeDatabaseError(billingProfiles.error)

    const athleteBySkfId = new Map(athletes.map((athlete) => [normaliseSkfId(String(athlete.skfId || '')), athlete]))
    const billingBySkfId = new Map(
      (billingProfiles.data || []).map((profile) => [
        normaliseSkfId(String(profile.skf_id || '')),
        normalizeAmount(profile.monthly_fee),
      ])
    )
    const targets = monthlyRows
      .filter((row) => row.status === 'due' || row.status === 'overdue')
      .map((row) => {
        const athlete = athleteBySkfId.get(row.skf_id)
        const expected = billingBySkfId.get(row.skf_id) ?? normalizeAmount(athlete?.monthlyFee)
        return { row, athlete, expected }
      })
      .filter(({ athlete }) => canSeeBranch(session, athlete?.branchName))
      .filter(({ athlete }) => branchMatchesCity(athlete?.branchName, input.city))
      .filter(({ athlete }) => branchMatchesFilter(athlete?.branchName, branchFilter))
      .filter(({ row, expected }) => Math.abs(normalizeAmount(row.amount) - expected) > 1)

    const now = new Date().toISOString()
    let reconciled = 0
    for (const { row, expected } of targets) {
      const { data, error } = await supabaseAdmin
        .from('fee_records')
        .update({ amount: expected, updated_at: now })
        .eq('id', row.id)
        .select('*')
        .single()
      if (error) throwFeeDatabaseError(error)
      await logAudit(session, {
        action: 'data_quality_amount_reconciled',
        skfId: row.skf_id,
        feeRecordId: row.id,
        before: row,
        after: data,
        metadata: { year, month },
      })
      reconciled += 1
    }

    return { success: true, action: input.action, reconciled, year, month }
  }

  static async createFollowup(session: Session, input: FeeFollowupCreateInput) {
    assertWrite(session)
    requireFeeDatabase()
    const skfId = normaliseSkfId(input.skfId)
    await assertCanAccessSkfId(session, skfId)

    const { data, error } = await supabaseAdmin
      .from('fee_followups')
      .insert({
        skf_id: skfId,
        fee_type: input.feeType || 'monthly',
        month: normalizeMonth(input.month),
        year: input.year,
        contacted_by: actorName(session),
        contacted_by_role: actorRole(session),
        contact_method: input.contactMethod,
        note: input.note || null,
      })
      .select('*')
      .single()
    if (error) throwFeeDatabaseError(error)

    await logAudit(session, {
      action: 'fee_followup_logged',
      skfId,
      after: data,
      metadata: {
        month: normalizeMonth(input.month),
        year: input.year,
        contactMethod: input.contactMethod,
      },
    })

    return {
      success: true,
      followup: {
        id: data.id,
        skfId: data.skf_id,
        feeType: data.fee_type,
        month: data.month,
        year: data.year,
        contactedBy: data.contacted_by,
        contactedByRole: data.contacted_by_role,
        contactMethod: data.contact_method,
        note: data.note,
        createdAt: data.created_at,
      },
    }
  }

  static async sendReminders(session: Session, input: FeeReminderSendInput) {
    assertWrite(session)
    requireFeeDatabase()

    const siteUrl = String(env.NEXT_PUBLIC_SITE_URL || env.NEXT_PUBLIC_APP_URL || 'https://www.skfkarate.org').replace(/\/$/, '')
    const results = []

    for (const target of input.targets) {
      const skfId = normaliseSkfId(target.skfId)
      try {
        const athlete = await assertCanAccessSkfId(session, skfId)
        const selectedFeeRecordIds = Array.from(new Set([
          ...(target.feeRecordIds || []),
          ...(target.feeRecordId ? [target.feeRecordId] : []),
        ].filter(Boolean)))
        const rows = selectedFeeRecordIds.length
          ? (await getFeeRows({ skfId }))
            .filter((candidate) => selectedFeeRecordIds.includes(candidate.id))
          : await getFeeRows({
              skfId,
              feeType: target.feeType || 'monthly',
              month: normalizeMonth(target.month),
              year: Number(target.year || currentPeriod().year),
            })
        if (selectedFeeRecordIds.length && rows.length !== selectedFeeRecordIds.length) {
          throw new NotFoundError('Selected pending fee record')
        }
        const selectedRows = selectedFeeRecordIds.length
          ? rows
          : rows.slice(0, 1)
        const payableRows = selectedRows
          .filter((row) => outstandingStatus(row.status))
          .map((row) => ({
            ...row,
            amount: target.amount !== undefined && selectedRows.length === 1
              ? normalizeAmount(target.amount)
              : effectiveFeeRecordAmount(row),
          }))
        if (!payableRows.length) throw new NotFoundError('Pending fee record')

        const primaryRow = payableRows[0]
        const amount = payableRows.reduce((sum, row) => sum + effectiveFeeRecordAmount(row), 0)
        const parentName = String(athlete.parentName || '').trim()
        const studentName = athleteName(athlete)
        const phone = normalizeIndianPhone(athlete.phone)
        const portalUrl = `${siteUrl}/portal/fees`
        const message = buildFeeReminderMessage({
          parentName,
          studentName,
          skfId,
          rows: payableRows,
          portalUrl,
        })
        const messageUrl = input.channel === 'whatsapp' ? buildWhatsAppUrl(phone, message) : ''
        const status = input.channel === 'whatsapp' && !messageUrl ? 'skipped' : 'prepared'
        const selectedFees = payableRows.map((row) => ({
          feeRecordId: row.id,
          feeType: row.fee_type,
          month: row.month,
          year: row.year,
          amount: effectiveFeeRecordAmount(row),
          label: reminderFeeTypeLabel(row),
        }))

        if (input.previewOnly) {
          results.push({
            success: true,
            skfId,
            reminder: null,
            messageUrl,
            message,
            selectedFees,
            status,
          })
          continue
        }

        const { data, error } = await supabaseAdmin
          .from('fee_reminder_logs')
          .insert({
            skf_id: skfId,
            fee_record_id: primaryRow.id,
            fee_type: primaryRow.fee_type,
            month: primaryRow.month,
            year: primaryRow.year,
            amount,
            channel: input.channel,
            template_key: input.templateKey || (payableRows.length > 1 ? 'selected_pending_fees' : 'fee_due'),
            recipient_name: parentName || studentName,
            recipient_phone: phone || null,
            message_body: message,
            message_url: messageUrl || null,
            provider: input.channel === 'whatsapp' ? 'manual_whatsapp' : 'manual',
            status,
            sent_by: actorName(session),
            sent_by_role: actorRole(session),
            metadata: {
              branch: athlete.branchName || null,
              note: input.note || null,
              selectedFees,
            },
          })
          .select('*')
          .single()
        if (error) throwFeeDatabaseError(error)

        if (input.markFollowup) {
          for (const row of payableRows) {
            await this.createFollowup(session, {
              skfId,
              feeType: row.fee_type,
              month: row.month,
              year: row.year,
              contactMethod: input.channel === 'whatsapp' ? 'whatsapp' : 'other',
              note: input.note || `Reminder prepared using ${input.channel}.`,
            })
          }
        }

        await logAudit(session, {
          action: 'fee_reminder_prepared',
          skfId,
          feeRecordId: primaryRow.id,
          after: data,
          metadata: {
            channel: input.channel,
            templateKey: input.templateKey,
            status,
            selectedFeeRecordIds: payableRows.map((row) => row.id),
          },
        })

        results.push({
          success: true,
          skfId,
          reminder: data,
          messageUrl,
          message,
          selectedFees,
          status,
        })
      } catch (error) {
        results.push({
          success: false,
          skfId,
          error: error instanceof Error ? error.message : 'Unable to prepare reminder.',
        })
      }
    }

    return {
      success: true,
      preparedCount: results.filter((result) => result.success).length,
      failureCount: results.filter((result) => !result.success).length,
      results,
    }
  }

  static async syncStudent(session: Session, skfId: string, year: number) {
    assertWrite(session)
    const athlete = await assertCanAccessSkfId(session, skfId)
    const billingProfile = await upsertBillingProfileFromAthlete(athlete)
    if (billingProfile.billing_status === 'discontinued') {
      return { success: true, skfId, year, created: 0, updated: 0, skipped: true }
    }

    const result = await ensureFeeRowsForStudent(skfId, {
      monthlyFee: normalizeAmount(billingProfile.monthly_fee || athlete.monthlyFee),
      enrolledDate: String(billingProfile.billing_start_date || athlete.joinDate || '').trim() || undefined,
      year,
      overwriteAmount: true,
    })

    const startMonth = billingProfile.billing_start_date
      ? normalizeMonth(MONTHS[new Date(billingProfile.billing_start_date).getMonth()])
      : normalizeMonth(MONTHS[new Date(athlete.joinDate || new Date()).getMonth()])

    if (normalizeAmount(billingProfile.admission_fee) > 0) {
      await ensureFeeRecord({
        skfId,
        feeType: 'admission',
        month: startMonth,
        year,
        amount: normalizeAmount(billingProfile.admission_fee),
      })
    }
    if (normalizeAmount(billingProfile.dress_fee) > 0) {
      await ensureFeeRecord({
        skfId,
        feeType: 'dress',
        month: startMonth,
        year,
        amount: normalizeAmount(billingProfile.dress_fee),
        metadata: { dressCost: normalizeAmount(billingProfile.dress_cost) },
      })
    }

    await logAudit(session, { action: 'sync_student_fee_rows', skfId, metadata: { year, ...result } })
    return { success: true, skfId, year, ...result }
  }

  static async applyPortalCredit(skfId: string, input: {
    creditId: string
    month: string
    year: number
    feeType: string
  }): Promise<{ appliedAmount: number; remainingDue: number }> {
    requireFeeDatabase()
    const normalizedSkfId = normaliseSkfId(skfId)
    const athlete = await getAthleteBySkfIdLive(normalizedSkfId) as AthleteRecord | null
    if (!athlete) throw new NotFoundError('Student')

    const month = normalizeMonth(input.month)
    const feeType = input.feeType || 'monthly'
    const year = input.year

    // Call the atomic RPC
    const { data: creditResult, error: creditError } = await supabaseAdmin.rpc('apply_fee_credit', {
      p_credit_id: input.creditId,
      p_skf_id: normalizedSkfId,
      p_month: month,
      p_year: year,
      p_fee_type: feeType,
      p_actor: `Portal: ${athleteName(athlete)}`,
    })
    if (creditError) throwFeeDatabaseError(creditError)

    const creditPayload = creditResult as {
      credit?: Record<string, unknown>
      adjustment?: Record<string, unknown>
    } | null
    const credit = creditPayload?.credit
    const adjustment = creditPayload?.adjustment
    if (!credit || !adjustment) throw new NotFoundError('Credit')

    const amount = normalizeAmount(credit.amount)

    // Check if the credit fully covers the target fee record
    const existingCreditRows = await getFeeRows({
      skfId: normalizedSkfId,
      feeType: 'credit_adjustment',
      month,
      year,
    })
    const existingCreditAmount = existingCreditRows.reduce((sum, row) => sum + normalizeAmount(row.amount), 0)
    const targetRows = await getFeeRows({ skfId: normalizedSkfId, feeType, month, year })
    let targetRow = targetRows[0]
    if (targetRow) {
      targetRow = await alignFeeRecordAmountWithTemporaryOverride(targetRow)
    }
    const targetAmount = targetRow ? effectiveFeeRecordAmount(targetRow) : normalizeAmount(athlete.monthlyFee)
    const remainingDue = Math.max(0, targetAmount - existingCreditAmount)

    if (targetRow && existingCreditAmount >= targetAmount) {
      const now = new Date().toISOString()
      const receiptId = receiptIdForPaidFee(targetRow, normalizedSkfId, feeType as FeeType, month, year)
      await supabaseAdmin
        .from('fee_records')
        .update({
          status: 'paid',
          paid_date: now,
          receipt_id: receiptId,
          payment_method: 'credit adjustment',
          verified_by: `Portal: ${athleteName(athlete)}`,
          verified_at: now,
          notes: 'Paid fully using fee credit.',
          updated_at: now,
        })
        .eq('id', targetRow.id)
    }

    notifyTreasuryAction('Portal Credit Applied', [
      `*Student:* ${athleteName(athlete)} (${normalizedSkfId})`,
      `*Credit:* ₹${amount}`,
      `*Applied To:* ${formatFeeTypeLabel(feeType)} / ${month} ${year}`,
      `*Source:* Athlete Portal (Self-Service)`
    ]).catch(err => logger.warn('fee.notify_treasury_action_failed', { err }))

    return { appliedAmount: amount, remainingDue }
  }

  static async submitPortalPaymentProof(skfId: string, input: PortalFeeProofInput) {
    const normalizedSkfId = normaliseSkfId(skfId)
    const athlete = await getAthleteBySkfIdLive(normalizedSkfId) as AthleteRecord | null
    if (!athlete) throw new NotFoundError('Student')

    const feeType = input.feeType || 'monthly'
    const month = normalizeMonth(input.month)
    const selectedFeeRecordIds = (input.feeRecordIds || []).filter(Boolean)
    const existingRows = selectedFeeRecordIds.length
      ? await getFeeRows({ skfId: normalizedSkfId }).then((rows) =>
        rows.filter((candidate) => selectedFeeRecordIds.includes(candidate.id))
      )
      : await getFeeRows({
        skfId: normalizedSkfId,
        feeType,
        month,
        year: input.year,
      })
    const existingRow = selectedFeeRecordIds.length
      ? existingRows.find((candidate) => candidate.fee_type === feeType && candidate.month === month && candidate.year === input.year) || existingRows[0] || null
      : existingRows[0] || null

    if (existingRow?.status === 'paid') {
      throw new ValidationError({ fee: ['This fee is already marked paid.'] })
    }

    let row = existingRow || await ensureFeeRecord({
      skfId: normalizedSkfId,
      feeType,
      month,
      year: input.year,
      amount: input.amount || normalizeAmount(athlete.monthlyFee),
    })
    row = await alignFeeRecordAmountWithTemporaryOverride(row)
    const paymentAmount = temporaryMonthlyFeeOverride(normalizedSkfId, feeType, month, input.year, {
      status: row.status,
      sourceKey: row.source_key,
    })
      ? effectiveFeeRecordAmount(row)
      : normalizeAmount(input.amount)
    const { data: replacedProofs, error: replacedProofsError } = await supabaseAdmin
      .from('fee_payment_proofs')
      .select('id, proof_path')
      .eq('fee_record_id', row.id)
      .eq('status', 'submitted')
    if (replacedProofsError) throwFeeDatabaseError(replacedProofsError)

    if (selectedFeeRecordIds.length && !selectedFeeRecordIds.includes(row.id)) {
      throw new ValidationError({ feeRecordIds: ['Selected fee record does not match the proof target.'] })
    }

    const paymentReference = String(input.paymentReference || '').trim()
    const paymentIntent = await createManualPaymentIntent({
      skfId: normalizedSkfId,
      row,
      amount: paymentAmount,
      paymentReference,
      proofName: input.paymentProofName,
    })

    const proof = decodePaymentProof(input)
    const proofId = crypto.randomUUID()
    const path = `${normalizedSkfId}/${input.year}/${month}/${proofId}.${proof.extension}`

    const { error: uploadError } = await supabaseAdmin.storage
      .from(PROOF_BUCKET)
      .upload(path, proof.buffer, {
        contentType: proof.contentType,
        upsert: false,
      })
    if (uploadError) throwFeeDatabaseError(uploadError)

    const proofPayload = {
      fee_record_id: row.id,
      payment_intent_id: paymentIntent?.id || null,
      skf_id: normalizedSkfId,
      amount: paymentAmount,
      payment_reference: paymentReference || null,
      proof_path: path,
      proof_filename: input.paymentProofName || null,
      metadata: {
        feeRecordIds: selectedFeeRecordIds.length ? selectedFeeRecordIds : [row.id],
        feeType,
        month,
        year: input.year,
        sourceType: row.source_type,
        sourceId: row.source_id,
        sourceLabel: row.source_label,
      },
    }

    let proofRow: Record<string, unknown> | null = null
    const { data: insertedProof, error: insertError } = await supabaseAdmin
      .from('fee_payment_proofs')
      .insert(proofPayload)
      .select('*')
      .single()
    if (insertError) {
      if (isOptionalWorkflowSchemaError(insertError)) {
        const { data: legacyProof, error: legacyError } = await supabaseAdmin
          .from('fee_payment_proofs')
          .insert({
            fee_record_id: row.id,
            skf_id: normalizedSkfId,
            amount: paymentAmount,
            proof_path: path,
            proof_filename: input.paymentProofName || null,
          })
          .select('*')
          .single()
        if (legacyError) {
          await supabaseAdmin.storage.from(PROOF_BUCKET).remove([path])
          throwFeeDatabaseError(legacyError)
        }
        proofRow = legacyProof as Record<string, unknown>
      } else {
        await supabaseAdmin.storage.from(PROOF_BUCKET).remove([path])
        throwFeeDatabaseError(insertError)
      }
    } else {
      proofRow = insertedProof as Record<string, unknown>
    }
    if (!proofRow) {
      await supabaseAdmin.storage.from(PROOF_BUCKET).remove([path])
      throw new ExternalServiceError('Unable to record payment proof.')
    }

    const oldProofPaths = (replacedProofs || [])
      .map((oldProof) => String(oldProof.proof_path || ''))
      .filter(Boolean)
    if ((replacedProofs || []).length) {
      const now = new Date().toISOString()
      const { error: replaceError } = await supabaseAdmin
        .from('fee_payment_proofs')
        .update({
          status: 'rejected',
          reviewed_by: 'System',
          reviewed_at: now,
          review_note: 'Replaced by a newer payment proof submission.',
        })
        .in('id', (replacedProofs || []).map((oldProof) => oldProof.id))
      if (replaceError) {
        logger.warn('fee.payment_proof_replace_old_failed', {
          skfId: normalizedSkfId,
          feeRecordId: row.id,
          error: replaceError,
        })
      } else if (oldProofPaths.length) {
        const { error: oldStorageError } = await supabaseAdmin.storage.from(PROOF_BUCKET).remove(oldProofPaths).catch((error) => {
          logger.warn('fee.payment_proof_old_storage_cleanup_failed', {
            skfId: normalizedSkfId,
            feeRecordId: row.id,
            error,
          })
          return { error }
        })
        if (!oldStorageError) {
          await clearProofFileReferences((replacedProofs || []).map((oldProof) => String(oldProof.id || '')), {
            action: 'replaced',
            skfId: normalizedSkfId,
            feeRecordId: row.id,
          })
        }
      }
    }

    const { data: updatedRowData, error: updateError } = await supabaseAdmin
      .from('fee_records')
      .update({
        status: 'pending_verification',
        rejected_reason: null,
        metadata: {
          ...(row.metadata || {}),
          latestProofId: proofRow.id,
          latestPaymentIntentId: paymentIntent?.id || null,
          latestPaymentReference: paymentReference || null,
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .select('*')
      .single()
    const updatedRow = updateError
      ? { ...row, status: 'pending_verification' as const }
      : normalizeFeeRecord(updatedRowData)
    if (updateError) {
      logger.warn('fee.payment_proof_fee_record_pending_update_failed', {
        skfId: normalizedSkfId,
        feeRecordId: row.id,
        proofId: String(proofRow.id || ''),
        error: updateError,
      })
    }

    await markPaymentIntentStatus({
      intentId: String(paymentIntent?.id || ''),
      status: 'submitted',
      proofId: String(proofRow.id || ''),
    }).catch(() => null)

    await logAudit(null, {
      action: 'portal_payment_proof_submitted',
      skfId: normalizedSkfId,
      feeRecordId: row.id,
      before: row,
      after: updatedRow,
      metadata: {
        proofId: String(proofRow.id || ''),
        paymentIntentId: paymentIntent?.id || null,
        paymentReference: paymentReference || null,
      },
    })

    await notifyPaymentProofSubmitted({
      skfId: normalizedSkfId,
      studentName: athleteName(athlete),
      branch: athlete.branchName || null,
      feeType,
      month,
      year: input.year,
      amount: paymentAmount,
      proofId: String(proofRow.id || ''),
      paymentReference,
      proofBuffer: proof.buffer,
      proofFilename: input.paymentProofName || 'proof.png',
      proofContentType: proof.contentType,
    })

    return {
      success: true,
      proofId: String(proofRow.id || ''),
      paymentIntentId: paymentIntent?.id || null,
      entry: rowToEntry(updatedRow, athlete),
    }
  }

  static async getPaymentProofs(session: Session, query: FeeConsoleQueryInput) {
    requireFeeDatabase()
    const athletes = (await getAllAthletesLive()) as AthleteRecord[]
    const visibleAthletes = athletes
      .filter((athlete) => canSeeBranch(session, athlete.branchName))
      .filter((athlete) => branchMatchesCity(athlete.branchName, query.city))
      .filter((athlete) => branchMatchesFilter(athlete.branchName, query.branch))
    const visibleSkfIds = visibleAthletes
      .map((athlete) => normaliseSkfId(String(athlete.skfId || '')))
      .filter(Boolean)
    const athleteBySkfId = new Map(visibleAthletes.map((athlete) => [normaliseSkfId(String(athlete.skfId || '')), athlete]))
    if (!visibleSkfIds.length) {
      return {
        citySummary: [],
        branchSummary: [],
        proofs: [],
        pagination: paginationFromCount(query, 0),
      }
    }

    const pagination = paginationFromCount(query, 0)
    let proofQuery = supabaseAdmin
      .from('fee_payment_proofs')
      .select('*', { count: 'exact' })
      .in('skf_id', visibleSkfIds)
      .order('submitted_at', { ascending: false })

    if (query.status && query.status !== 'all') {
      const proofStatus = query.status === 'pending_verification' ? 'submitted' : query.status
      if (['submitted', 'approved', 'rejected'].includes(proofStatus)) {
        proofQuery = proofQuery.eq('status', proofStatus)
      }
    }

    const { data, error, count } = await proofQuery.range(pagination.offset, pagination.offset + pagination.limit - 1)
    if (error) throwFeeDatabaseError(error)

    const proofs = (data || []) as PaymentProofRow[]
    const scopedProofs = proofs.map((proof) => ({
      proof,
      athlete: athleteBySkfId.get(proof.skf_id),
    }))
    const summaryRows = scopedProofs.map(({ proof, athlete }) => ({
      ...proof,
      branch: athlete?.branchName || 'Unknown',
      amount: proof.amount,
      status: (
        proof.status === 'submitted'
          ? 'pending_verification'
          : proof.status === 'approved'
            ? 'paid'
            : 'rejected'
      ) as FeeStatus,
    }))

    const result = []
    for (const { proof, athlete } of scopedProofs) {
      const proofPath = String(proof.proof_path || '').trim()
      const signed = proofPath
        ? await supabaseAdmin.storage.from(PROOF_BUCKET).createSignedUrl(proofPath, 10 * 60)
        : null
      const city = cityLabelForBranch(athlete?.branchName)
      result.push({
        ...proof,
        athleteName: athleteName(athlete),
        branch: athlete?.branchName || 'Unknown',
        city: city.city,
        citySlug: city.citySlug,
        signedUrl: signed?.data?.signedUrl || '',
      })
    }

    return {
      citySummary: buildCitySummary(summaryRows),
      branchSummary: buildBranchSummary(summaryRows),
      proofs: result,
      pagination: paginationFromCount(query, count || 0),
    }
  }

  static async approvePaymentProof(session: Session, proofId: string, note?: string) {
    assertWrite(session)
    const proof = await this.getPaymentProofRowForReview(session, proofId)
    if (proof.status !== 'submitted') {
      throw new ValidationError({ proof: ['This payment proof has already been reviewed.'] })
    }
    if (!proof.fee_record_id) throw new NotFoundError('Fee record')
    const [loadedRow] = await getFeeRows({ skfId: proof.skf_id })
      .then((rows) => rows.filter((candidate) => candidate.id === proof.fee_record_id))
    if (!loadedRow) throw new NotFoundError('Fee record')
    const row = await alignFeeRecordAmountWithTemporaryOverride(loadedRow)
    if (String(row.metadata?.latestProofId || '') && String(row.metadata.latestProofId) !== proofId) {
      throw new ValidationError({ proof: ['A newer payment proof was submitted for this fee.'] })
    }
    const expectedAmount = effectiveFeeRecordAmount(row)
    const submittedAmount = normalizeAmount(proof.amount)
    if (expectedAmount > 0 && submittedAmount > 0 && Math.abs(expectedAmount - submittedAmount) > 1) {
      throw new ValidationError({
        proof: [`Proof amount ${submittedAmount} does not match the ledger amount ${expectedAmount}. Reject the proof or adjust the ledger first.`],
      })
    }

    const receiptId = receiptIdForPaidFee(row)
    const now = new Date().toISOString()
    const { data: updatedRow, error: rowError } = await supabaseAdmin
      .from('fee_records')
      .update({
        status: 'paid',
        amount: proof.amount || row.amount,
        paid_date: now,
        receipt_id: receiptId,
        payment_method: ['UPI QR - screenshot verified', proof.payment_reference || ''].filter(Boolean).join(' • '),
        verified_by: actorName(session),
        verified_at: now,
        rejected_reason: null,
        updated_at: now,
      })
      .eq('id', row.id)
      .select('*')
      .single()
    if (rowError) throwFeeDatabaseError(rowError)
    const normalizedUpdatedRow = normalizeFeeRecord(updatedRow)
    const athlete = await getAthleteBySkfIdLive(row.skf_id) as AthleteRecord | null
    const receipt = await ensureReceiptForPaidRow({
      row: normalizedUpdatedRow,
      athlete: athlete || { skfId: row.skf_id, branchName: 'SKF Branch' },
      issuedAt: now,
    })

    const { data: updatedProof, error: proofError } = await supabaseAdmin
      .from('fee_payment_proofs')
      .update({
        status: 'approved',
        reviewed_by: actorName(session),
        reviewed_at: now,
        review_note: note || null,
      })
      .eq('id', proofId)
      .select('*')
      .single()
    if (proofError) throwFeeDatabaseError(proofError)
    let reviewedProof = updatedProof as PaymentProofRow


    await markPaymentIntentStatus({
      intentId: proof.payment_intent_id,
      status: 'paid',
      proofId,
      metadata: {
        receiptId: receipt?.receiptId || receiptId,
        reviewedBy: actorName(session),
        reviewedAt: now,
      },
    })

    reviewedProof = await cleanupReviewedProofStorage(reviewedProof, 'approved')

    await logAudit(session, {
      action: 'payment_proof_approved',
      skfId: row.skf_id,
      feeRecordId: row.id,
      before: row,
      after: updatedRow,
      metadata: {
        proofId,
        note,
        receiptId: receipt?.receiptId,
        paymentIntentId: proof.payment_intent_id || null,
        paymentReference: proof.payment_reference || null,
      },
    })

    notifyTreasuryAction('Payment Proof Approved', [
      `*Student:* ${athlete ? athleteName(athlete) : row.skf_id} (${row.skf_id})`,
      `*Fee:* ${formatFeeTypeLabel(row.fee_type)} / ${row.month} ${row.year}`,
      `*Amount:* ₹${updatedRow.amount}`,
      `*Approved By:* ${actorName(session)}`
    ]).catch(err => logger.warn('fee.notify_treasury_action_failed', { err }))

    return { success: true, proof: reviewedProof, entry: normalizedUpdatedRow, receipt }
  }

  static async rejectPaymentProof(session: Session, proofId: string, note?: string) {
    assertWrite(session)
    const proof = await this.getPaymentProofRowForReview(session, proofId)
    if (proof.status !== 'submitted') {
      throw new ValidationError({ proof: ['This payment proof has already been reviewed.'] })
    }
    if (!note?.trim()) {
      throw new ValidationError({ note: ['Rejection reason is required.'] })
    }
    const now = new Date().toISOString()

    const { data: updatedProof, error: proofError } = await supabaseAdmin
      .from('fee_payment_proofs')
      .update({
        status: 'rejected',
        reviewed_by: actorName(session),
        reviewed_at: now,
        review_note: note,
      })
      .eq('id', proofId)
      .select('*')
      .single()
    if (proofError) throwFeeDatabaseError(proofError)
    let reviewedProof = updatedProof as PaymentProofRow

    await markPaymentIntentStatus({
      intentId: proof.payment_intent_id,
      status: 'rejected',
      proofId,
      metadata: {
        reviewNote: note,
        reviewedBy: actorName(session),
        reviewedAt: now,
      },
    }).catch(() => null)

    let updatedRow = null
    if (proof.fee_record_id) {
      const [row] = await getFeeRows({ skfId: proof.skf_id })
        .then((rows) => rows.filter((candidate) => candidate.id === proof.fee_record_id))
      if (row && String(row.metadata?.latestProofId || '') && String(row.metadata.latestProofId) !== proofId) {
        throw new ValidationError({ proof: ['A newer payment proof was submitted for this fee.'] })
      }
      const { data, error } = await supabaseAdmin
        .from('fee_records')
        .update({
          status: 'rejected',
          rejected_reason: note,
          updated_at: now,
        })
        .eq('id', proof.fee_record_id)
        .select('*')
        .single()
      if (error) throwFeeDatabaseError(error)
      updatedRow = data
    }

    reviewedProof = await cleanupReviewedProofStorage(reviewedProof, 'rejected')

    await logAudit(session, {
      action: 'payment_proof_rejected',
      skfId: proof.skf_id,
      feeRecordId: proof.fee_record_id || undefined,
      after: updatedRow || reviewedProof,
      metadata: {
        proofId,
        note,
        paymentIntentId: proof.payment_intent_id || null,
        paymentReference: proof.payment_reference || null,
      },
    })

    notifyTreasuryAction('Payment Proof Rejected', [
      `*Student:* ${proof.skf_id}`,
      `*Reason:* ${note}`,
      `*Rejected By:* ${actorName(session)}`
    ]).catch(err => logger.warn('fee.notify_treasury_action_failed', { err }))

    return { success: true, proof: reviewedProof, entry: updatedRow ? normalizeFeeRecord(updatedRow) : null }
  }

  private static async getPaymentProofRowForReview(session: Session, proofId: string): Promise<PaymentProofRow> {
    requireFeeDatabase()
    const { data, error } = await supabaseAdmin
      .from('fee_payment_proofs')
      .select('*')
      .eq('id', proofId)
      .single()
    if (error) throwFeeDatabaseError(error)
    if (!data) throw new NotFoundError('Payment proof')

    await assertCanAccessSkfId(session, data.skf_id)
    return data as PaymentProofRow
  }

  static async getCredits(session: Session, query: FeeConsoleQueryInput) {
    requireFeeDatabase()
    const athletes = (await getAllAthletesLive()) as AthleteRecord[]
    const visibleAthletes = athletes
      .filter((athlete) => canSeeBranch(session, athlete.branchName))
      .filter((athlete) => branchMatchesCity(athlete.branchName, query.city))
      .filter((athlete) => branchMatchesFilter(athlete.branchName, query.branch))
    const visibleSkfIds = visibleAthletes
      .map((athlete) => normaliseSkfId(String(athlete.skfId || '')))
      .filter(Boolean)
    const athleteBySkfId = new Map(visibleAthletes.map((athlete) => [normaliseSkfId(String(athlete.skfId || '')), athlete]))
    if (!visibleSkfIds.length) {
      return {
        citySummary: [],
        branchSummary: [],
        credits: [],
        pagination: paginationFromCount(query, 0),
      }
    }

    const pagination = paginationFromCount(query, 0)
    let queryBuilder = supabaseAdmin
      .from('fee_credits')
      .select('*', { count: 'exact' })
      .in('skf_id', visibleSkfIds)
      .order('created_at', { ascending: false })
    if (query.status && query.status !== 'all') queryBuilder = queryBuilder.eq('status', query.status)
    const { data, error, count } = await queryBuilder.range(pagination.offset, pagination.offset + pagination.limit - 1)
    if (error) throwFeeDatabaseError(error)

    const credits = (data || [])
      .map((credit) => ({ ...credit, athlete: athleteBySkfId.get(normaliseSkfId(String(credit.skf_id || ''))) }))
      .map((credit) => ({
        ...credit,
        athleteName: athleteName(credit.athlete),
        branch: credit.athlete?.branchName || credit.branch || 'Unknown',
        ...cityLabelForBranch(credit.athlete?.branchName || credit.branch || 'Unknown'),
        athlete: undefined,
      }))

    return {
      citySummary: buildCitySummary(credits),
      branchSummary: buildBranchSummary(credits),
      credits,
      pagination: paginationFromCount(query, count || 0),
    }
  }

  static async createCredit(session: Session, input: FeeCreditCreateInput) {
    assertWrite(session)
    const skfId = normaliseSkfId(input.skfId)
    const athlete = await assertCanAccessSkfId(session, skfId)
    const code = `CR_${skfId}_${Date.now().toString(36).toUpperCase()}`
    const { data, error } = await supabaseAdmin
      .from('fee_credits')
      .insert({
        credit_code: code,
        skf_id: skfId,
        branch: athlete.branchName || null,
        amount: input.amount,
        reason: input.reason,
        description: input.description || null,
      })
      .select('*')
      .single()
    if (error) throwFeeDatabaseError(error)
    await logAudit(session, { action: 'fee_credit_created', skfId, after: data })
    notifyTreasuryAction('Fee Credit Issued', [
      `*Student:* ${athleteName(athlete)} (${skfId})`,
      `*Amount:* ₹${input.amount}`,
      `*Reason:* ${input.reason}`,
      `*Note:* ${input.description || 'N/A'}`,
      `*Issued By:* ${actorName(session)}`
    ]).catch(err => logger.warn('fee.notify_treasury_action_failed', { err }))
    return data
  }

  static async updateCredit(session: Session, creditId: string, input: Partial<FeeCreditCreateInput>) {
    assertWrite(session)
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('fee_credits')
      .select('*')
      .eq('id', creditId)
      .single()
    if (fetchError || !existing) throw new NotFoundError('Credit record')
    
    await assertCanAccessSkfId(session, existing.skf_id)

    const updates: Record<string, number | string | null> = {}
    if (input.amount !== undefined) updates.amount = input.amount
    if (input.reason !== undefined) updates.reason = input.reason
    if (input.description !== undefined) updates.description = input.description || null

    const { data, error } = await supabaseAdmin
      .from('fee_credits')
      .update(updates)
      .eq('id', creditId)
      .select('*')
      .single()
      
    if (error) throwFeeDatabaseError(error)
    await logAudit(session, { action: 'fee_credit_updated', skfId: existing.skf_id, before: existing, after: data })
    return data
  }

  static async deleteCredit(session: Session, creditId: string) {
    assertWrite(session)
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('fee_credits')
      .select('*')
      .eq('id', creditId)
      .single()
    if (fetchError || !existing) throw new NotFoundError('Credit record')

    await assertCanAccessSkfId(session, existing.skf_id)

    const { error } = await supabaseAdmin
      .from('fee_credits')
      .delete()
      .eq('id', creditId)
      
    if (error) throwFeeDatabaseError(error)
    await logAudit(session, { action: 'fee_credit_deleted', skfId: existing.skf_id, before: existing })
    return { success: true }
  }

  static async getDevelopmentFund(session: Session, query: FeeConsoleQueryInput) {
    const year = Number(query.year || currentPeriod().year)
    const ledger = await this.getLedger(session, { ...query, year, feeType: 'all' })
    const incomeByMonth = new Map<string, number>()
    for (const entry of ledger.entries) {
      if (entry.status !== 'paid') continue
      if (entry.feeType === 'credit_adjustment') {
        incomeByMonth.set(entry.month, (incomeByMonth.get(entry.month) || 0) - Math.abs(entry.amount))
        continue
      }
      if (entry.feeType === 'monthly') {
        incomeByMonth.set(entry.month, (incomeByMonth.get(entry.month) || 0) + entry.amount)
        continue
      }
    }

    const { data: expenses, error } = await supabaseAdmin
      .from('development_fund_expenses')
      .select('*')
      .eq('year', year)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (error) throwFeeDatabaseError(error)
    const visibleExpenses = (expenses || []).filter((expense) =>
      expenseMatchesLocation(expense.scope, query.city, query.branch)
    )

    const monthlyBreakdown = MONTHS.map((month) => {
      const collected = Math.max(0, incomeByMonth.get(month) || 0)
      const devFund = Math.round(collected * 0.3)
      const spent = visibleExpenses
        .filter((expense) => normalizeMonth(expense.month) === month)
        .reduce((sum, expense) => sum + normalizeAmount(expense.amount), 0)
      return { month, year, collected, devFund, spent, carryForward: 0 }
    })

    let running = 0
    for (const row of monthlyBreakdown) {
      running += row.devFund - row.spent
      row.carryForward = running
    }

    return {
      year,
      city: query.city || '',
      branch: query.branch || '',
      citySummary: ledger.citySummary,
      branchSummary: ledger.branchSummary,
      monthlyBreakdown,
      expenses: visibleExpenses,
      totalContributions: monthlyBreakdown.reduce((sum, row) => sum + row.devFund, 0),
      totalSpent: monthlyBreakdown.reduce((sum, row) => sum + row.spent, 0),
      availableBalance: running,
    }
  }

  static async createDevelopmentExpense(session: Session, input: DevelopmentFundExpenseInput) {
    assertWrite(session)
    const code = `DEV_${Date.now().toString(36).toUpperCase()}`
    const { data, error } = await supabaseAdmin
      .from('development_fund_expenses')
      .insert({
        expense_code: code,
        month: normalizeMonth(input.month),
        year: input.year,
        title: input.title,
        description: input.description || null,
        scope: input.scope || 'Both',
        amount: input.amount,
        created_by: actorName(session),
      })
      .select('*')
      .single()
    if (error) throwFeeDatabaseError(error)
    await logAudit(session, { action: 'development_fund_expense_created', after: data })
    notifyTreasuryAction('Development Fund Expense', [
      `*Amount:* ₹${input.amount}`,
      `*Category:* ${input.title}`,
      `*Note:* ${input.description || 'N/A'}`,
      `*Recorded By:* ${actorName(session)}`
    ]).catch(err => logger.warn('fee.notify_treasury_action_failed', { err }))
    return data
  }

  static async deleteDevelopmentExpense(session: Session, expenseId: string) {
    assertWrite(session)
    requireFeeDatabase()
    const normalizedId = String(expenseId || '').trim()
    if (!normalizedId) {
      throw new ValidationError({ expenseId: ['Expense ID is required.'] })
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('development_fund_expenses')
      .select('*')
      .eq('id', normalizedId)
      .is('deleted_at', null)
      .maybeSingle()
    if (existingError) throwFeeDatabaseError(existingError)
    if (!existing) throw new NotFoundError('Development expense')

    const createdAt = new Date(String(existing.created_at || ''))
    const ageMs = Date.now() - createdAt.getTime()
    if (!Number.isFinite(ageMs) || ageMs > 24 * 60 * 60 * 1000) {
      throw new ValidationError({
        expenseId: ['Expenses can only be deleted within 24 hours of creation.'],
      })
    }

    const { data, error } = await supabaseAdmin
      .from('development_fund_expenses')
      .update({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', normalizedId)
      .select('*')
      .single()
    if (error) throwFeeDatabaseError(error)

    await logAudit(session, {
      action: 'development_fund_expense_deleted',
      before: existing,
      after: data,
    })
    notifyTreasuryAction('Development Expense Deleted', [
      `*Title:* ${existing.title}`,
      `*Amount:* ₹${existing.amount}`,
      `*Deleted By:* ${actorName(session)}`
    ]).catch(err => logger.warn('fee.notify_treasury_action_failed', { err }))
    return { success: true, expense: data }
  }

  static async getReceiptDataForAdmin(session: Session, receiptId: string) {
    requireFeeDatabase()
    const normalizedReceiptId = String(receiptId || '').trim()
    if (!normalizedReceiptId) return null

    const snapshot = await FeeReceiptsService.getReceiptById(normalizedReceiptId)
    if (snapshot && !snapshot.voidedAt) {
      await assertCanAccessSkfId(session, snapshot.skfId)
      return snapshot
    }

    const { data, error } = await supabaseAdmin
      .from('fee_records')
      .select('id, skf_id, fee_type, month, year, amount, status, paid_date, receipt_id, payment_method, verified_by, verified_at, rejected_reason, notes, metadata, source_key, source_type, source_id, source_label, due_date, branch_snapshot, created_at, updated_at')
      .eq('receipt_id', normalizedReceiptId)
      .maybeSingle()
    if (error) throwFeeDatabaseError(error)
    if (!data) return null

    const row = normalizeFeeRecord(data)
    if (row.status !== 'paid') return null

    const athlete = await assertCanAccessSkfId(session, row.skf_id)
    return {
      receiptId: normalizedReceiptId,
      skfId: row.skf_id,
      athleteName: athleteName(athlete),
      branch: athlete.branchName || 'SKF Branch',
      feeType: formatFeeTypeLabel(row.fee_type),
      month: row.month,
      year: row.year,
      amount: row.amount,
      paidDate: row.paid_date || new Date().toISOString(),
      paymentMethod: row.payment_method || 'Manual Entry',
      verifiedBy: row.verified_by || '',
      verifiedAt: row.verified_at || row.paid_date || '',
      dojoAddress: dojoAddressForBranch(athlete.branchName),
      issuedAt: row.verified_at || row.paid_date || new Date().toISOString(),
      themeId: 'skf_iconic',
      source: 'legacy',
    }
  }

  static async createExtraIncome(session: Session, input: FeeExtraIncomeInput) {
    assertWrite(session)
    requireFeeDatabase()

    const code = `INC-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`.toUpperCase()

    const { data, error } = await supabaseAdmin
      .from('fee_extra_incomes')
      .insert({
        income_code: code,
        month: normalizeMonth(input.month),
        year: input.year,
        title: input.title,
        description: input.description || null,
        scope: input.scope || 'Both',
        amount: input.amount,
        created_by: actorName(session),
      })
      .select('*')
      .single()
    if (error) throwFeeDatabaseError(error)
    await logAudit(session, { action: 'fee_extra_income_created', after: data })
    notifyTreasuryAction('Extra Income Recorded', [
      `*Amount:* ₹${input.amount}`,
      `*Source:* ${input.title}`,
      `*Note:* ${input.description || 'N/A'}`,
      `*Recorded By:* ${actorName(session)}`
    ]).catch(err => logger.warn('fee.notify_treasury_action_failed', { err }))
    return data
  }

  static async deleteExtraIncome(session: Session, incomeId: string) {
    assertWrite(session)
    requireFeeDatabase()
    const normalizedId = String(incomeId || '').trim()
    if (!normalizedId) {
      throw new ValidationError({ incomeId: ['Income ID is required.'] })
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('fee_extra_incomes')
      .select('*')
      .eq('id', normalizedId)
      .is('deleted_at', null)
      .maybeSingle()
    if (existingError) throwFeeDatabaseError(existingError)
    if (!existing) throw new NotFoundError('Extra income')

    const createdAt = new Date(String(existing.created_at || ''))
    const ageMs = Date.now() - createdAt.getTime()
    if (!Number.isFinite(ageMs) || ageMs > 24 * 60 * 60 * 1000) {
      throw new ValidationError({
        incomeId: ['Incomes can only be deleted within 24 hours of creation.'],
      })
    }

    const { data, error } = await supabaseAdmin
      .from('fee_extra_incomes')
      .update({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', normalizedId)
      .select('*')
      .single()
    if (error) throwFeeDatabaseError(error)

    await logAudit(session, {
      action: 'fee_extra_income_deleted',
      before: existing,
      after: data,
    })
    notifyTreasuryAction('Extra Income Deleted', [
      `*Title:* ${existing.title}`,
      `*Amount:* ₹${existing.amount}`,
      `*Deleted By:* ${actorName(session)}`
    ]).catch(err => logger.warn('fee.notify_treasury_action_failed', { err }))
    return { success: true, income: data }
  }

  static async createRemoval(session: Session, input: FeeRemovalInput) {
    assertWrite(session)
    requireFeeDatabase()

    const code = `RMV-${Date.now().toString(36).toUpperCase()}`

    const { data, error } = await supabaseAdmin
      .from('fee_removals')
      .insert({
        removal_code: code,
        month: normalizeMonth(input.month),
        year: input.year,
        title: input.title,
        description: input.description || null,
        scope: input.scope || 'Both',
        amount: input.amount,
        created_by: actorName(session),
      })
      .select('*')
      .single()
    if (error) throwFeeDatabaseError(error)
    await logAudit(session, { action: 'fee_removal_created', after: data })
    notifyTreasuryAction('Custom Removal Recorded', [
      `*Amount:* ₹${input.amount}`,
      `*Source:* ${input.title}`,
      `*Note:* ${input.description || 'N/A'}`,
      `*Recorded By:* ${actorName(session)}`
    ]).catch(err => logger.warn('fee.notify_treasury_action_failed', { err }))
    return data
  }

  static async deleteRemoval(session: Session, removalId: string) {
    assertWrite(session)
    requireFeeDatabase()
    const normalizedId = String(removalId || '').trim()
    if (!normalizedId) {
      throw new ValidationError({ removalId: ['Removal ID is required.'] })
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('fee_removals')
      .select('*')
      .eq('id', normalizedId)
      .is('deleted_at', null)
      .maybeSingle()
    if (existingError) throwFeeDatabaseError(existingError)
    if (!existing) throw new NotFoundError('Custom removal')

    const createdAt = new Date(String(existing.created_at || ''))
    const ageMs = Date.now() - createdAt.getTime()
    if (!Number.isFinite(ageMs) || ageMs > 24 * 60 * 60 * 1000) {
      throw new ValidationError({
        removalId: ['Removals can only be deleted within 24 hours of creation.'],
      })
    }

    const { data, error } = await supabaseAdmin
      .from('fee_removals')
      .update({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', normalizedId)
      .select('*')
      .single()
    if (error) throwFeeDatabaseError(error)

    await logAudit(session, {
      action: 'fee_removal_deleted',
      before: existing,
      after: data,
    })
    notifyTreasuryAction('Custom Removal Deleted', [
      `*Title:* ${existing.title}`,
      `*Amount:* ₹${existing.amount}`,
      `*Deleted By:* ${actorName(session)}`
    ]).catch(err => logger.warn('fee.notify_treasury_action_failed', { err }))
    return { success: true, removal: data }
  }

  static async getExamMonths(session: Session) {
    if (!FEE_ACCESS_ROLES.includes(actorRole(session))) {
      throw new AuthorizationError('Insufficient permissions.')
    }
    requireFeeDatabase()
    const { data, error } = await supabaseAdmin
      .from('exam_months')
      .select('year, month, created_at')
      .order('year', { ascending: false })
      .order('month', { ascending: false })
    if (error) throwFeeDatabaseError(error)
    return data || []
  }

  static async setExamMonth(session: Session, year: number, month: string) {
    if (!WRITE_ROLES.has(actorRole(session))) {
      throw new AuthorizationError('Insufficient permissions.')
    }
    requireFeeDatabase()
    const normalizedMonth = normalizeMonth(month)
    const { data, error } = await supabaseAdmin
      .from('exam_months')
      .insert({ year, month: normalizedMonth })
      .select('*')
      .single()

    if (error) {
      if (error.code === '23505') {
        // Unique constraint violation
        return { success: true }
      }
      throwFeeDatabaseError(error)
    }

    await logAudit(session, {
      action: 'exam_month_set',
      after: data,
      metadata: { year, month: normalizedMonth }
    })
    return { success: true, ...data }
  }
}
