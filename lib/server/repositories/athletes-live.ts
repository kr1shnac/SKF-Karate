import { randomUUID } from 'node:crypto'
import { cache } from 'react'

import { calculateAllRanks } from '../../utils/rank'
import { buildCompetitionResultsFromAthletes, getAthleteRankEntry } from '../../utils/rankings'
import { generateSkfId, getBranchCode, normaliseSkfId, parseSkfId } from '../../utils/registration'
import { ensureInitialWhiteBeltAchievement } from '../../utils/athlete-achievements'
import { ApiError } from '../api'
import type { Athlete } from '@/data/types'
import { isSupabaseReady, supabaseAdmin } from '../supabase'
import { logger } from '@/src/server/lib/logger'
import { isPgrst303 } from '@/src/server/lib/pgrst-errors'
import {
  getAllAthletes,
  getAthleteById,
  getAthleteBySkfId,
  getAthleteRank,
} from './athletes'

type AthleteAchievement = Record<string, unknown> & {
  type?: string
}
type AthletePointsHistoryEntry = Record<string, unknown>

type AthleteRecord = {
  id: string
  skfId: string
  firstName: string
  lastName: string
  dateOfBirth: string
  gender: string
  photoUrl: string
  branchName: string
  currentBelt: string
  joinDate: string
  status: string
  parentName: string
  phone: string
  email: string
  batch: string
  monthlyFee: number
  photoConsent: boolean
  consentGivenAt: string | null
  isPublic: boolean
  isFeatured: boolean
  achievements: AthleteAchievement[]
  pointsHistory: AthletePointsHistoryEntry[]
  pointsBalance: number
  pointsLifetime: number
  attendanceRate: number | null
  createdAt: string
  updatedAt: string
}

type AthleteInput = Partial<AthleteRecord>

type AthleteDatabaseRow = {
  id?: string
  skf_id?: string | null
  registration_number?: string | null
  first_name?: string | null
  last_name?: string | null
  date_of_birth?: string | null
  gender?: string | null
  photo_url?: string | null
  branch_name?: string | null
  current_belt?: string | null
  join_date?: string | null
  status?: string | null
  parent_name?: string | null
  phone?: string | null
  email?: string | null
  batch?: string | null
  monthly_fee?: number | string | null
  photo_consent?: boolean | null
  consent_given_at?: string | null
  is_public?: boolean | null
  is_featured?: boolean | null
  achievements?: unknown
  points_history?: unknown
  points_balance?: number | string | null
  points_lifetime?: number | string | null
  attendance_rate?: number | string | null
  created_at?: string | null
  updated_at?: string | null
}

type RankSnapshot = {
  athleteId?: string
  overallRank?: number | null
  totalPoints?: number
  totalMedals?: number
}

type DatabaseWriteError = {
  code?: string
  message?: string
}

function isMissingSkfIdColumnError(error: unknown) {
  const maybeError = error as { code?: string; message?: string }
  const message = String(maybeError?.message || '').toLowerCase()

  return (
    maybeError?.code === '42703' ||
    maybeError?.code === 'PGRST204' ||
    (message.includes('skf_id') && message.includes('column'))
  )
}

function cloneAthleteData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const PGRST303_RETRY_MS = 1000

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function normalizedText(value: unknown, fallback = '') {
  const normalized = String(value ?? '').trim()
  return normalized || fallback
}

function normalizedLowerText(value: unknown, fallback = '') {
  return normalizedText(value, fallback).toLowerCase()
}

function readBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value
  if (value === null || value === undefined || value === '') return fallback

  const normalized = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true
  if (['false', '0', 'no', 'n'].includes(normalized)) return false

  return fallback
}

function buildRankSnapshotsForAthletes(athletes: AthleteRecord[]) {
  const results = buildCompetitionResultsFromAthletes(athletes as unknown as Athlete[])
  return calculateAllRanks(athletes, results, new Date())
}

function buildSearchResult(athlete: AthleteRecord, rankSnapshot?: RankSnapshot) {
  return {
    skfId: athlete.skfId,
    firstName: athlete.firstName,
    lastName: athlete.lastName,
    branchName: athlete.branchName,
    currentBelt: athlete.currentBelt,
    photoUrl: athlete.photoUrl,
    overallRank: rankSnapshot?.overallRank ?? null,
    totalPoints: rankSnapshot?.totalPoints ?? 0,
    totalMedals: rankSnapshot?.totalMedals ?? 0,
  }
}

function mapAthleteRowToRecord(row: AthleteDatabaseRow): AthleteRecord {
  const skfId = row.skf_id || row.registration_number || row.id || ''
  const branchName = normalizedText(row.branch_name)
  const joinDate = normalizedText(row.join_date)
  const achievements = ensureInitialWhiteBeltAchievement(
    Array.isArray(row.achievements) ? row.achievements : [],
    {
      joinDate,
      branchName,
    }
  )

  return {
    id: normalizedText(row.id),
    skfId: normaliseSkfId(String(skfId)),
    firstName: normalizedText(row.first_name),
    lastName: normalizedText(row.last_name),
    dateOfBirth: normalizedText(row.date_of_birth),
    gender: normalizedLowerText(row.gender, 'male'),
    photoUrl: normalizedText(row.photo_url),
    branchName,
    currentBelt: normalizedLowerText(row.current_belt, 'white'),
    joinDate,
    status: normalizedLowerText(row.status, 'active'),
    parentName: normalizedText(row.parent_name),
    phone: normalizedText(row.phone),
    email: normalizedText(row.email),
    batch: normalizedText(row.batch),
    monthlyFee: Number(row.monthly_fee || 0),
    photoConsent: readBoolean(row.photo_consent, false),
    consentGivenAt: row.consent_given_at || null,
    isPublic: readBoolean(row.is_public, true),
    isFeatured: readBoolean(row.is_featured, false),
    achievements,
    pointsHistory: Array.isArray(row.points_history) ? row.points_history : [],
    pointsBalance: Number(row.points_balance || 0),
    pointsLifetime: Number(row.points_lifetime || 0),
    attendanceRate:
      row.attendance_rate === null || row.attendance_rate === undefined
        ? null
        : Number(row.attendance_rate),
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
  }
}

type AthleteIdentifierColumn = 'skf_id' | 'registration_number'

function mapAthleteRecordToRow(
  record: AthleteRecord,
  identifierColumn: AthleteIdentifierColumn = 'skf_id'
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: record.id,
    first_name: record.firstName,
    last_name: record.lastName,
    date_of_birth: record.dateOfBirth || null,
    gender: record.gender || 'male',
    photo_url: record.photoUrl || null,
    branch_name: record.branchName || null,
    current_belt: record.currentBelt || 'white',
    join_date: record.joinDate || null,
    status: record.status || 'active',
    parent_name: record.parentName || null,
    phone: record.phone || null,
    email: record.email || null,
    batch: record.batch || null,
    monthly_fee: Number(record.monthlyFee || 0),
    photo_consent: Boolean(record.photoConsent),
    consent_given_at: record.consentGivenAt || null,
    is_public: typeof record.isPublic === 'boolean' ? record.isPublic : true,
    is_featured: typeof record.isFeatured === 'boolean' ? record.isFeatured : false,
    achievements: Array.isArray(record.achievements) ? record.achievements : [],
    points_history: Array.isArray(record.pointsHistory) ? record.pointsHistory : [],
    points_balance: Number(record.pointsBalance || 0),
    points_lifetime: Number(record.pointsLifetime || 0),
    attendance_rate:
      record.attendanceRate === null || record.attendanceRate === undefined
        ? null
        : Number(record.attendanceRate),
    created_at: record.createdAt || new Date().toISOString(),
    updated_at: record.updatedAt || new Date().toISOString(),
  }

  row[identifierColumn] = record.skfId

  return row
}

function normaliseAthletePayload(
  input: AthleteInput = {},
  existing: AthleteRecord | null = null
): AthleteRecord {
  const now = new Date().toISOString()
  const joinDate =
    input.joinDate || existing?.joinDate || new Date().toISOString().split('T')[0]
  const branchName = input.branchName || existing?.branchName || ''
  const achievements = Array.isArray(input.achievements)
    ? input.achievements
    : existing?.achievements || []

  return {
    id: existing?.id || input.id || `athlete_${randomUUID()}`,
    skfId:
      input.skfId || existing?.skfId || '',
    firstName: input.firstName?.trim() || existing?.firstName || '',
    lastName: input.lastName?.trim() || existing?.lastName || '',
    dateOfBirth: input.dateOfBirth || existing?.dateOfBirth || '',
    gender: input.gender || existing?.gender || 'male',
    photoUrl: input.photoUrl || existing?.photoUrl || '',
    branchName,
    currentBelt: input.currentBelt || existing?.currentBelt || 'white',
    joinDate,
    status: input.status || existing?.status || 'active',
    parentName: input.parentName || existing?.parentName || '',
    phone: input.phone || existing?.phone || '',
    email: input.email || existing?.email || '',
    batch: input.batch || existing?.batch || '',
    monthlyFee: typeof input.monthlyFee === 'number' && Number.isFinite(input.monthlyFee)
      ? input.monthlyFee
      : existing?.monthlyFee != null
        ? existing.monthlyFee
        : (branchName.toLowerCase() === 'herohalli' ? 500 : 0),
    photoConsent:
      typeof input.photoConsent === 'boolean'
        ? input.photoConsent
        : existing?.photoConsent ?? false,
    consentGivenAt:
      input.consentGivenAt === null
        ? null
        : (input.consentGivenAt || existing?.consentGivenAt) ?? null,
    isPublic:
      typeof input.isPublic === 'boolean' ? input.isPublic : existing?.isPublic ?? true,
    isFeatured:
      typeof input.isFeatured === 'boolean'
        ? input.isFeatured
        : existing?.isFeatured ?? false,
    achievements: ensureInitialWhiteBeltAchievement(achievements, {
      joinDate,
      branchName,
    }),
    pointsHistory: Array.isArray(input.pointsHistory)
      ? input.pointsHistory
      : existing?.pointsHistory || [],
    pointsBalance: typeof input.pointsBalance === 'number' && Number.isFinite(input.pointsBalance)
      ? input.pointsBalance
      : existing?.pointsBalance || 0,
    pointsLifetime: typeof input.pointsLifetime === 'number' && Number.isFinite(input.pointsLifetime)
      ? input.pointsLifetime
      : existing?.pointsLifetime || 0,
    attendanceRate:
      input.attendanceRate === null || input.attendanceRate === undefined
        ? existing?.attendanceRate ?? null
        : Number(input.attendanceRate),
    createdAt: existing?.createdAt || input.createdAt || now,
    updatedAt: now,
  }
}

export async function getAthletesByPhonesLive(phones: string[]): Promise<AthleteRecord[]> {
  const normalizedPhones = phones.map(p => p.replace(/\D/g, '').slice(-10)).filter(Boolean)
  if (normalizedPhones.length === 0) return []

  if (!isSupabaseReady()) {
    const all = await getAthleteDataset()
    return all.filter(a => {
      const digits = String(a.phone || '').replace(/\D/g, '').slice(-10)
      return digits && normalizedPhones.includes(digits)
    })
  }

  // Use ilike to match phones regardless of formatting (e.g. "+91 98765 43210" matches "9876543210")
  const filters = normalizedPhones.map(p => `phone.ilike.%${p}`)
  const { data, error } = await supabaseAdmin
    .from('athletes')
    .select('*')
    .or(filters.join(','))

  if (error) {
    logger.warn('athletes_live.phone_query_failed', { error, filters })

    const all = await getAthleteDataset()
    return all.filter(a => {
      const digits = String(a.phone || '').replace(/\D/g, '').slice(-10)
      return digits && normalizedPhones.includes(digits)
    })
  }

  return (data || []).map(mapAthleteRowToRecord)
}

async function readAllAthletesFromDatabase(): Promise<AthleteRecord[]> {
  const allData: Record<string, unknown>[] = []
  let offset = 0
  const pageSize = 1000

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('athletes')
      .select('*')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (error) throw error
    if (!data || data.length === 0) break
    allData.push(...data)
    if (data.length < pageSize) break
    offset += pageSize
  }

  return allData.map(mapAthleteRowToRecord)
}

const getAthleteDataset = cache(async function getAthleteDataset(): Promise<AthleteRecord[]> {
  if (!isSupabaseReady()) {
    return cloneAthleteData(getAllAthletes() as unknown as AthleteRecord[])
  }

  try {
    return await readAllAthletesFromDatabase()
  } catch (error) {
    if (isPgrst303(error)) {
      logger.warn('athletes_live.pgrst303_retry', { error })
      await sleep(PGRST303_RETRY_MS)
      try {
        return await readAllAthletesFromDatabase()
      } catch (retryError) {
        logger.warn('athletes_live.local_fallback_retry_failed', { error: retryError })
      }
    } else {
      logger.warn('athletes_live.local_fallback', { error })
    }
    return cloneAthleteData(getAllAthletes() as unknown as AthleteRecord[])
  }
})

async function getNextSequenceNumberLive(year: number, branchName = 'MP'): Promise<number> {
  const athletes = await getAthleteDataset()
  const branchCode = getBranchCode(branchName)
  const sequences = athletes
    .map((athlete) => parseSkfId(String(athlete.skfId || '')))
    .filter((parts) => {
      if (!parts || parts.year !== year) return false
      return parts.branchCode === branchCode || (parts.legacy && branchCode === 'MP')
    })
    .map((parts) => parts?.sequence || 0)
    .filter((value) => Number.isFinite(value))

  return sequences.length > 0 ? Math.max(...sequences) + 1 : 1
}

async function hasAthleteSkfIdLive(
  skfId: string,
  excludeId: string | null = null
): Promise<boolean> {
  const normalized = normaliseSkfId(skfId)
  const athletes = await getAthleteDataset()

  return athletes.some((athlete) => {
    return (
      String(athlete.skfId || '').toUpperCase() === normalized.toUpperCase() &&
      athlete.id !== excludeId
    )
  })
}

function handleAthleteWriteError(error: DatabaseWriteError): never {
  if (error?.code === 'PGRST205') {
    throw new ApiError(
      500,
      'Supabase schema is incomplete: missing "athletes" table. Run database/schema.sql in the connected Supabase project.'
    )
  }

  if (isMissingSkfIdColumnError(error)) {
    throw new ApiError(
      500,
      'Supabase athletes schema is incomplete: missing "athletes.skf_id". Run database/migrations/011_rename_registration_number_to_skf_id.sql.'
    )
  }

  if (error?.code === '23505') {
    throw new ApiError(409, 'An athlete with this SKF ID already exists.')
  }

  throw new ApiError(500, error?.message || 'Unable to persist the athlete record.')
}

export async function getAllAthletesLive() {
  return cloneAthleteData(await getAthleteDataset())
}

async function findAthleteByColumn(column: string, lookupCandidates: string[]) {
  for (const lookup of lookupCandidates) {
    const query = supabaseAdmin.from('athletes').select('*')
    const { data, error } = await (column === 'id' ? query.eq(column, lookup) : query.ilike(column, lookup)).maybeSingle()

    if (error) {
      if (error.code !== 'PGRST116') throw error
    } else if (data) {
      return mapAthleteRowToRecord(data)
    }
  }

  return null
}

export async function getAthleteBySkfIdLive(skfId: string): Promise<AthleteRecord | null> {
  if (!isSupabaseReady()) {
    return cloneAthleteData(getAthleteBySkfId(skfId) as unknown as AthleteRecord | null)
  }

  try {
    const normalized = normaliseSkfId(skfId)
    const lookupCandidates = Array.from(
      new Set([normalized, String(skfId || '').trim()].filter(Boolean))
    )

    try {
      const athleteBySkfId = await findAthleteByColumn('skf_id', lookupCandidates)
      if (athleteBySkfId) return athleteBySkfId
    } catch (error) {
      if (!isMissingSkfIdColumnError(error)) throw error

      const athleteByMigratingColumn = await findAthleteByColumn(
        'registration_number',
        lookupCandidates
      )
      if (athleteByMigratingColumn) return athleteByMigratingColumn
    }

    const athleteById = await findAthleteByColumn('id', lookupCandidates)
    if (athleteById) return athleteById

    return null
  } catch (error) {
    logger.warn('athletes_live.local_lookup_by_skf_id_fallback', { skfId, error })
    return cloneAthleteData(getAthleteBySkfId(skfId) as unknown as AthleteRecord | null)
  }
}

export async function getAthleteByIdLive(id: string): Promise<AthleteRecord | null> {
  if (!isSupabaseReady()) {
    return cloneAthleteData(getAthleteById(id) as unknown as AthleteRecord | null)
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('athletes')
      .select('*')
      .eq('id', id)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null
      throw error
    }

    return mapAthleteRowToRecord(data)
  } catch (error) {
    logger.warn('athletes_live.local_lookup_by_id_fallback', { id, error })
    return cloneAthleteData(getAthleteById(id) as unknown as AthleteRecord | null)
  }
}

export async function getFeaturedAthletesLive() {
  const athletes = await getAthleteDataset()

  return cloneAthleteData(
    athletes.filter(
      (athlete) => athlete.isFeatured && athlete.isPublic && athlete.status === 'active'
    )
  )
}

export async function searchAthletesByNameLive(query: string) {
  if (!query) return []

  const lowerQuery = query.toLowerCase().trim()
  const normalizedSkfQuery = normaliseSkfId(query).toLowerCase()
  const compactSkfQuery = normalizedSkfQuery.replace(/-/g, '')
  const athletes = await getAthleteDataset()
  const rankSnapshots = buildRankSnapshotsForAthletes(athletes)
  const rankMap = new Map(rankSnapshots.map((entry) => [String(entry.athleteId), entry]))

  const getSearchFields = (athlete: AthleteRecord) => {
    const firstName = String(athlete.firstName || '').toLowerCase()
    const lastName = String(athlete.lastName || '').toLowerCase()
    const fullName = `${firstName} ${lastName}`.trim()
    const athleteId = normaliseSkfId(String(athlete.id || '')).toLowerCase()
    const skfId = normaliseSkfId(
      String(athlete.skfId || '')
    ).toLowerCase()
    const compactAthleteId = athleteId.replace(/-/g, '')
    const compactSkfId = skfId.replace(/-/g, '')

    return {
      firstName,
      lastName,
      fullName,
      athleteId,
      skfId,
      compactAthleteId,
      compactSkfId,
    }
  }

  return athletes
    .filter((athlete) => {
      if (!athlete.isPublic || athlete.status !== 'active') return false

      const fields = getSearchFields(athlete)
      return (
        fields.firstName.includes(lowerQuery) ||
        fields.lastName.includes(lowerQuery) ||
        fields.fullName.includes(lowerQuery) ||
        fields.athleteId.includes(normalizedSkfQuery) ||
        fields.skfId.includes(normalizedSkfQuery) ||
        fields.compactAthleteId.includes(compactSkfQuery) ||
        fields.compactSkfId.includes(compactSkfQuery)
      )
    })
    .sort((a, b) => {
      const aFields = getSearchFields(a)
      const bFields = getSearchFields(b)
      const aRank = rankMap.get(String(a.id))
      const bRank = rankMap.get(String(b.id))

      const getPriority = (fields: ReturnType<typeof getSearchFields>) => {
        if (
          fields.athleteId === normalizedSkfQuery ||
          fields.skfId === normalizedSkfQuery ||
          fields.compactAthleteId === compactSkfQuery ||
          fields.compactSkfId === compactSkfQuery
        ) {
          return 0
        }
        if (
          fields.athleteId.startsWith(normalizedSkfQuery) ||
          fields.skfId.startsWith(normalizedSkfQuery) ||
          fields.compactAthleteId.startsWith(compactSkfQuery) ||
          fields.compactSkfId.startsWith(compactSkfQuery)
        ) {
          return 1
        }
        if (fields.fullName === lowerQuery) return 2
        if (fields.fullName.startsWith(lowerQuery)) return 3
        return 4
      }

      const priorityDiff = getPriority(aFields) - getPriority(bFields)
      if (priorityDiff !== 0) return priorityDiff

      const pointDiff = Number(bRank?.totalPoints || 0) - Number(aRank?.totalPoints || 0)
      if (pointDiff !== 0) return pointDiff

      return aFields.fullName.localeCompare(bFields.fullName)
    })
    .map((athlete) => buildSearchResult(athlete, rankMap.get(String(athlete.id))))
}

export async function getFeaturedAthleteSearchResultsLive(limit = 6) {
  const athletes = await getAthleteDataset()
  const rankSnapshots = buildRankSnapshotsForAthletes(athletes)
  const rankMap = new Map(rankSnapshots.map((entry) => [String(entry.athleteId), entry]))

  const featured = athletes
    .filter((athlete) => athlete.isPublic && athlete.status === 'active')
    .sort((a, b) => {
      const aRank = rankMap.get(String(a.id))
      const bRank = rankMap.get(String(b.id))
      const pointDiff = Number(bRank?.totalPoints || 0) - Number(aRank?.totalPoints || 0)
      if (pointDiff !== 0) return pointDiff

      const featuredDiff = Number(Boolean(b.isFeatured)) - Number(Boolean(a.isFeatured))
      if (featuredDiff !== 0) return featuredDiff

      return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)
    })
    .slice(0, limit)

  return featured.map((athlete) => buildSearchResult(athlete, rankMap.get(String(athlete.id))))
}

export async function getRankSnapshotsLive() {
  const athletes = await getAthleteDataset()
  return buildRankSnapshotsForAthletes(athletes)
}

export async function getAthleteRankLive(athleteId: string) {
  const athletes = await getAthleteDataset()
  const results = buildCompetitionResultsFromAthletes(athletes as unknown as Athlete[])
  const rankInfo = getAthleteRankEntry(athleteId, athletes as unknown as Athlete[], results)

  if (!rankInfo) return null

  return {
    branchRank: rankInfo.branchRank,
    overallRank: rankInfo.overallRank,
    totalPoints: rankInfo.totalPoints,
    rankingCategory: rankInfo.rankingCategory,
  }
}

export async function createAthleteLive(input: AthleteInput) {
  if (!isSupabaseReady()) {
    throw new ApiError(503, 'Athlete database is not available.')
  }

  const joinDate = input.joinDate || new Date().toISOString().split('T')[0]
  const joinYear = Number.parseInt(String(joinDate).slice(0, 4), 10) || new Date().getFullYear()
  const requestedSkfId = input.skfId
    ? normaliseSkfId(input.skfId)
    : ''
  const branchName = input.branchName || 'MP'
  const skfId =
    requestedSkfId ||
    generateSkfId(joinYear, branchName, await getNextSequenceNumberLive(joinYear, branchName))

  if (await hasAthleteSkfIdLive(skfId)) {
    throw new ApiError(409, 'An athlete with this SKF ID already exists.')
  }

  const athlete = normaliseAthletePayload({
    ...input,
    joinDate,
    skfId,
  })

  let { data, error } = await supabaseAdmin
    .from('athletes')
    .insert(mapAthleteRecordToRow(athlete))
    .select('*')
    .single()

  if (error && isMissingSkfIdColumnError(error)) {
    ;({ data, error } = await supabaseAdmin
      .from('athletes')
      .insert(mapAthleteRecordToRow(athlete, 'registration_number'))
      .select('*')
      .single())
  }

  if (error) {
    handleAthleteWriteError(error)
  }

  return mapAthleteRowToRecord(data)
}

export async function updateAthleteLive(id: string, input: AthleteInput) {
  if (!isSupabaseReady()) {
    throw new ApiError(503, 'Athlete database is not available.')
  }

  const existingAthlete = await getAthleteByIdLive(id)
  if (!existingAthlete) return null

  const skfId = input.skfId
    ? normaliseSkfId(input.skfId)
    : existingAthlete.skfId

  if (await hasAthleteSkfIdLive(skfId, id)) {
    throw new ApiError(409, 'An athlete with this SKF ID already exists.')
  }

  const athlete = normaliseAthletePayload(
    { ...input, skfId },
    existingAthlete
  )

  let { data, error } = await supabaseAdmin
    .from('athletes')
    .update(mapAthleteRecordToRow(athlete))
    .eq('id', id)
    .select('*')
    .single()

  if (error && isMissingSkfIdColumnError(error)) {
    ;({ data, error } = await supabaseAdmin
      .from('athletes')
      .update(mapAthleteRecordToRow(athlete, 'registration_number'))
      .eq('id', id)
      .select('*')
      .single())
  }

  if (error) {
    handleAthleteWriteError(error)
  }

  return mapAthleteRowToRecord(data)
}

export async function upsertAthleteMirror(input: AthleteInput) {
  const normalizedSkfId = normaliseSkfId(input.skfId || '')
  if (!normalizedSkfId) {
    throw new ApiError(400, 'SKF ID is required to sync an athlete mirror.')
  }

  const existing = await getAthleteBySkfIdLive(normalizedSkfId)

  if (existing) {
    return updateAthleteLive(existing.id, {
      ...existing as AthleteInput,
      ...input,
      skfId: normalizedSkfId,
    })
  }

  return createAthleteLive({
    ...input,
    skfId: normalizedSkfId,
  })
}

export async function getAthleteRankOrFallback(athleteId: string) {
  return isSupabaseReady()
    ? getAthleteRankLive(athleteId)
    : Promise.resolve(getAthleteRank(athleteId))
}

/**
 * Flip an athlete's portal eligibility (athletes.status). The athlete portal
 * only lets students log in when status is 'active', so this is what removes
 * (or restores) portal access when billing is discontinued / resumed.
 */
export async function setAthletePortalStatus(skfId: string, status: 'active' | 'inactive') {
  if (!isSupabaseReady()) return
  const normalizedSkfId = normaliseSkfId(String(skfId || '').trim().toUpperCase())
  if (!normalizedSkfId) return
  await supabaseAdmin
    .from('athletes')
    .update({ status })
    .eq('skf_id', normalizedSkfId)
}
