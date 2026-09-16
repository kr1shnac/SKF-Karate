import { randomUUID } from 'node:crypto'

import { instructors } from '@/data/seed/instructors'
import { type Branch, cities as staticCities } from '@/lib/classesData'
import {
  SENSEI_ACCENTS,
  type SenseiAccent,
  type SenseiBranchAssignment,
  type SenseiProfile,
  type SenseiSummary,
} from '@/lib/types/sensei'

import { ApiError } from '../api'
import { isSupabaseReady, supabaseAdmin } from '../supabase'
import { logger } from '@/src/server/lib/logger'
import { cache } from 'react'
import { isPgrst303 } from '@/src/server/lib/pgrst-errors'

const PGRST303_RETRY_MS = 1000

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

type SenseiRow = {
  id: string
  slug: string
  name: string
  title: string | null
  dan: string | null
  role: string | null
  specialty: string | null
  experience: string | null
  description: string | null
  full_bio: string | null
  achievements: unknown
  quote: string | null
  image_url: string | null
  accent_color: string | null
  is_founder: boolean | null
  is_executive_committee: boolean | null
  is_public: boolean | null
  is_active: boolean | null
  is_assignable: boolean | null
  sort_order: number | null
}

type SupabaseWriteError = {
  code?: string
  message?: string
}

type BranchAssignmentRow = {
  slug: string
  name: string
  city_slug: string
  lead_sensei_id: string | null
}

type CityLookupRow = {
  slug: string
  name: string
}

const DEFAULT_IMAGE = '/no-profile/no profile male.png'

function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function slugify(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

function normalizePersonKey(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^sensei\s+/i, '')
    .replace(/^renshi\s+/i, '')
    .replace(/^dr\.\s+/i, '')
    .replace(/\s+/g, ' ')
}

function normalizeAccent(value: unknown): SenseiAccent {
  const normalized = String(value || '').trim().toLowerCase()
  return (SENSEI_ACCENTS as readonly string[]).includes(normalized) ? (normalized as SenseiAccent) : 'gold'
}

function normalizeText(
  value: unknown,
  label: string,
  options: { required?: boolean; max?: number } = {}
) {
  const normalized = String(value ?? '').trim()
  const max = options.max ?? 500

  if (!normalized) {
    if (options.required) {
      throw new ApiError(400, `${label} is required.`)
    }
    return ''
  }

  if (normalized.length > max) {
    throw new ApiError(400, `${label} is too long.`)
  }

  return normalized
}

function normalizeOptionalText(value: unknown, max = 500) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return ''
  if (normalized.length > max) {
    throw new ApiError(400, 'Value is too long.')
  }
  return normalized
}

function normalizeSlug(value: unknown, fallback: string, label: string) {
  const normalized = slugify(String(value ?? '') || fallback)
  if (!normalized) {
    throw new ApiError(400, `${label} is required.`)
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
    throw new ApiError(400, `${label} is invalid.`)
  }

  return normalized
}

function normalizeSortOrder(value: unknown, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.trunc(parsed))
}

function normalizeBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return fallback
}

function normalizeAchievements(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : String(value ?? '')
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean)

  return source.map((entry) => String(entry).trim()).filter(Boolean)
}

function ensureSupabaseForSenseisAdmin() {
  if (!isSupabaseReady()) {
    throw new ApiError(500, 'Sensei admin requires Supabase to be configured.')
  }
}

function handleSenseiWriteError(error: SupabaseWriteError, label: string): never {
  if (error?.code === 'PGRST205') {
    throw new ApiError(
      500,
      'Supabase schema is incomplete: missing sensei tables. Run database/schema.sql in the connected Supabase project.'
    )
  }

  if (error?.code === '23505') {
    throw new ApiError(409, `${label} already exists.`)
  }

  throw new ApiError(500, error?.message || `Unable to persist the ${label.toLowerCase()}.`)
}

function createAssignmentMapFromStaticBranches() {
  const assignments = new Map<string, SenseiBranchAssignment[]>()

  for (const city of staticCities) {
    for (const branch of city.branches) {
      const key = normalizePersonKey(branch.sensei)
      if (!key || key === 'to be updated') continue

      const bucket: SenseiBranchAssignment[] = assignments.get(key) || []
      bucket.push({
        citySlug: city.slug,
        cityName: city.name,
        branchSlug: branch.slug,
        branchName: branch.name,
      })
      assignments.set(key, bucket)
    }
  }

  return assignments
}

function buildFallbackSenseiFromBranch(
  branch: Branch,
  assignments: SenseiBranchAssignment[],
  sortOrder: number
): SenseiProfile {
  const name = branch.sensei
  const slugBase = normalizePersonKey(name) || name

  return {
    id: `sensei_${slugify(slugBase || name) || randomUUID().replace(/-/g, '')}`,
    slug: normalizeSlug('', slugBase || name, 'Sensei slug'),
    name,
    title: 'Lead Instructor',
    dan: branch.senseiDan || 'Lead Instructor',
    role: 'Lead Instructor',
    specialty: 'Branch Training',
    experience: '',
    description:
      branch.description ||
      `${name} leads day-to-day SKF Karate training for ${branch.name}.`,
    fullBio:
      branch.description ||
      `${name} leads day-to-day SKF Karate training for ${branch.name}.`,
    achievements: [],
    quote: '',
    imageUrl: DEFAULT_IMAGE,
    accent: 'gold',
    isFounder: false,
    isExecutiveCommittee: false,
    isPublic: true,
    isActive: true,
    isAssignable: true,
    sortOrder,
    assignments,
  }
}

export function buildStaticSenseiDataset(): SenseiProfile[] {
  const assignmentMap = createAssignmentMapFromStaticBranches()
  const records: SenseiProfile[] = []
  const seenNames = new Set<string>()

  for (const [index, instructor] of instructors.entries()) {
    const shouldInclude =
      instructor.isFounder ||
      instructor.isExecutiveCommittee ||
      instructor.isSensei ||
      /^sensei\b/i.test(instructor.name)
    if (!shouldInclude) continue

    const assignments = assignmentMap.get(normalizePersonKey(instructor.name)) || []
    const isAssignable = Boolean(
      instructor.isSensei ||
      /^sensei\b/i.test(instructor.name) ||
      assignments.length > 0
    )
    const record: SenseiProfile = {
      id: instructor.id,
      slug: instructor.slug,
      name: instructor.name,
      title: instructor.title || instructor.role || 'Lead Instructor',
      dan: instructor.dan || instructor.rank || 'Lead Instructor',
      role: instructor.role || instructor.title || 'Lead Instructor',
      specialty: instructor.specialty || 'Karate Instruction',
      experience: instructor.experience || '',
      description: instructor.desc || `${instructor.name} serves in the SKF Karate coaching team.`,
      fullBio: instructor.fullBio || instructor.desc || `${instructor.name} serves in the SKF Karate coaching team.`,
      achievements: Array.isArray(instructor.achievements) ? instructor.achievements : [],
      quote: instructor.quote || '',
      imageUrl: instructor.image || DEFAULT_IMAGE,
      objectPosition: instructor.objectPosition,
      hidePhoto: instructor.hidePhoto,
      accent: normalizeAccent(instructor.color),
      isFounder: Boolean(instructor.isFounder),
      isExecutiveCommittee: Boolean(instructor.isExecutiveCommittee),
      isPublic: true,
      isActive: true,
      isAssignable,
      sortOrder: index,
      assignments,
    }

    records.push(record)
    seenNames.add(normalizePersonKey(record.name))
  }

  for (const city of staticCities) {
    for (const branch of city.branches) {
      const key = normalizePersonKey(branch.sensei)
      if (!key || key === 'to be updated' || seenNames.has(key)) continue

      const assignments = assignmentMap.get(key) || []
      records.push(buildFallbackSenseiFromBranch(branch, assignments, records.length))
      seenNames.add(key)
    }
  }

  return records.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
  )
}

function mapSenseiRowToRecord(
  row: SenseiRow,
  assignments: SenseiBranchAssignment[]
): SenseiProfile {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    title: row.title || row.role || 'Lead Instructor',
    dan: row.dan || 'Lead Instructor',
    role: row.role || row.title || 'Lead Instructor',
    specialty: row.specialty || 'Karate Instruction',
    experience: row.experience || '',
    description: row.description || `${row.name} serves in the SKF Karate coaching team.`,
    fullBio:
      row.full_bio ||
      row.description ||
      `${row.name} serves in the SKF Karate coaching team.`,
    achievements: Array.isArray(row.achievements)
      ? row.achievements.map((entry) => String(entry))
      : [],
    quote: row.quote || '',
    imageUrl: row.image_url || DEFAULT_IMAGE,
    hidePhoto: row.image_url ? (row.image_url.includes('/no-profile/') || row.image_url.includes('no profile')) : true,
    accent: normalizeAccent(row.accent_color),
    isFounder: Boolean(row.is_founder),
    isExecutiveCommittee: Boolean(row.is_executive_committee),
    isPublic: row.is_public !== false,
    isActive: row.is_active !== false,
    isAssignable: row.is_assignable !== false,
    sortOrder: row.sort_order || 0,
    assignments,
  }
}

async function readAllSenseisFromDatabase() {
  const [{ data: senseiRows, error: senseiError }, { data: branchRows, error: branchError }, { data: cityRows, error: cityError }] =
    await Promise.all([
      supabaseAdmin
        .from('senseis')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      supabaseAdmin
        .from('class_branches')
        .select('slug,name,city_slug,lead_sensei_id')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      supabaseAdmin.from('class_cities').select('slug,name'),
    ])

  if (senseiError) throw senseiError
  if (branchError && branchError.code !== 'PGRST205') throw branchError
  if (cityError && cityError.code !== 'PGRST205') throw cityError

  const cityNameBySlug = new Map<string, string>(
    ((cityRows || []) as CityLookupRow[]).map((city) => [city.slug, city.name])
  )

  const assignmentsBySenseiId = new Map<string, SenseiBranchAssignment[]>()

  for (const branch of (branchRows || []) as BranchAssignmentRow[]) {
    if (!branch.lead_sensei_id) continue

    const bucket = assignmentsBySenseiId.get(branch.lead_sensei_id) || []
    bucket.push({
      citySlug: branch.city_slug,
      cityName: cityNameBySlug.get(branch.city_slug) || branch.city_slug,
      branchSlug: branch.slug,
      branchName: branch.name,
    })
    assignmentsBySenseiId.set(branch.lead_sensei_id, bucket)
  }

  return ((senseiRows || []) as SenseiRow[]).map((row) =>
    mapSenseiRowToRecord(row, assignmentsBySenseiId.get(row.id) || [])
  )
}

function getStaticSenseiDataset() {
  return cloneData(buildStaticSenseiDataset())
}

export const getAllSenseisLive = cache(async function getAllSenseisLive() {
  if (!isSupabaseReady()) {
    return getStaticSenseiDataset()
  }

  try {
    return cloneData(await readAllSenseisFromDatabase())
  } catch (error) {
    if (isPgrst303(error)) {
      logger.warn('senseis_live.pgrst303_retry', { error })
      await sleep(PGRST303_RETRY_MS)
      try {
        return cloneData(await readAllSenseisFromDatabase())
      } catch (retryError) {
        logger.warn('senseis_live.static_fallback_retry_failed', { error: retryError })
      }
    } else {
      logger.warn('senseis_live.static_fallback', { error })
    }
    return getStaticSenseiDataset()
  }
})

export async function getPublicSenseisLive() {
  const records = await getAllSenseisLive()
  return records.filter((sensei) => sensei.isPublic && sensei.isActive)
}

export async function getPublicExecutiveCommitteeLive() {
  const records = await getAllSenseisLive()
  const staticCommittee = getStaticSenseiDataset().filter(
    (sensei) => sensei.isFounder || sensei.isExecutiveCommittee
  )
  const liveById = new Map(records.map((sensei) => [sensei.id, sensei]))
  const liveBySlug = new Map(records.map((sensei) => [sensei.slug, sensei]))
  const usedLiveKeys = new Set<string>()
  const merged: SenseiProfile[] = []

  for (const staticSensei of staticCommittee) {
    const liveSensei = liveById.get(staticSensei.id) || liveBySlug.get(staticSensei.slug)

    if (liveSensei) {
      usedLiveKeys.add(liveSensei.id)
      usedLiveKeys.add(liveSensei.slug)

      if (
        liveSensei.isPublic &&
        liveSensei.isActive &&
        (liveSensei.isFounder || liveSensei.isExecutiveCommittee)
      ) {
        merged.push(liveSensei)
      }

      continue
    }

    if (staticSensei.isPublic && staticSensei.isActive) {
      merged.push(staticSensei)
    }
  }

  for (const liveSensei of records) {
    if (
      !liveSensei.isPublic ||
      !liveSensei.isActive ||
      (!liveSensei.isFounder && !liveSensei.isExecutiveCommittee) ||
      usedLiveKeys.has(liveSensei.id) ||
      usedLiveKeys.has(liveSensei.slug)
    ) {
      continue
    }

    merged.push(liveSensei)
  }

  return merged
    .sort((a, b) => {
      if (a.isFounder !== b.isFounder) return a.isFounder ? -1 : 1
      return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
    })
}

export async function getAssignableSenseisLive() {
  const records = await getAllSenseisLive()
  return records.filter((sensei) => sensei.isAssignable && sensei.isActive)
}

export async function getSenseiBySlugLive(slug: string) {
  const normalized = String(slug || '').trim()
  if (!normalized) return null
  const records = await getAllSenseisLive()
  return records.find((sensei) => sensei.slug === normalized) || null
}

export async function getPublicSenseiBySlugLive(slug: string) {
  const sensei = await getSenseiBySlugLive(slug)
  if (sensei) {
    return sensei.isPublic && sensei.isActive ? sensei : null
  }

  const normalized = String(slug || '').trim()
  const staticSensei = getStaticSenseiDataset().find((record) => record.slug === normalized)
  if (!staticSensei || !staticSensei.isPublic || !staticSensei.isActive) return null
  return staticSensei
}

export async function getSenseiByIdLive(id: string) {
  const normalized = String(id || '').trim()
  if (!normalized) return null
  const records = await getAllSenseisLive()
  return records.find((sensei) => sensei.id === normalized) || null
}

export async function getBranchCoachNameMapLive() {
  const records = await getAllSenseisLive()
  const map: Record<string, string> = {}

  for (const sensei of records) {
    for (const assignment of sensei.assignments) {
      map[assignment.branchName] = sensei.name
    }
  }

  return map
}

/**
 * Focused, per-request cached coach map used by the athlete dashboard. Instead
 * of hydrating every full sensei profile (bios, images, achievements), it reads
 * only `senseis(id,name)` + `class_branches(name,lead_sensei_id)` and produces
 * the same `{ branchName: sensei.name }` mapping. Falls back to the full
 * dataset when the branch table is missing or Supabase is unavailable.
 */
export const getBranchCoachNameMapLiveFocused = cache(async function getBranchCoachNameMapLiveFocused(): Promise<Record<string, string>> {
  if (isSupabaseReady()) {
    try {
      const [{ data: senseiRows, error: senseiError }, { data: branchRows, error: branchError }] =
        await Promise.all([
          supabaseAdmin.from('senseis').select('id,name'),
          supabaseAdmin.from('class_branches').select('name,lead_sensei_id'),
        ])

      if (senseiError) throw senseiError
      if (branchError && branchError.code !== 'PGRST205') throw branchError

      const nameById = new Map<string, string>(
        ((senseiRows || []) as Array<{ id: string; name: string }>).map((sensei) => [sensei.id, sensei.name])
      )

      const map: Record<string, string> = {}
      for (const branch of (branchRows || []) as Array<{ name: string; lead_sensei_id: string | null }>) {
        if (!branch.lead_sensei_id) continue
        const name = nameById.get(branch.lead_sensei_id)
        if (name) map[branch.name] = name
      }

      if (branchError && branchError.code === 'PGRST205') {
        logger.warn('senseis_live.coach_map_branch_table_missing', { error: branchError })
        return getBranchCoachNameMapLive()
      }

      return map
    } catch (error) {
      logger.warn('senseis_live.coach_map_focused_fallback', { error })
    }
  }

  return getBranchCoachNameMapLive()
})

async function prepareSenseiUpsertPayload(
  input: Partial<SenseiProfile> & { achievementsText?: string },
  existing?: SenseiRow | null
) {
  const name = normalizeText(input.name ?? existing?.name, 'Sensei name', {
    required: true,
    max: 160,
  })
  const slug = normalizeSlug(input.slug ?? existing?.slug, name, 'Sensei slug')
  const title = normalizeText(
    input.title ?? existing?.title ?? input.role ?? existing?.role ?? 'Lead Instructor',
    'Title',
    { required: true, max: 160 }
  )
  const role = normalizeText(
    input.role ?? existing?.role ?? input.title ?? existing?.title ?? title,
    'Role',
    { required: true, max: 160 }
  )
  const dan = normalizeText(input.dan ?? existing?.dan ?? 'Lead Instructor', 'Dan / rank', {
    required: true,
    max: 120,
  })
  const description =
    normalizeText(input.description ?? existing?.description, 'Description', {
      max: 500,
    }) ||
    `${name} serves in the SKF Karate coaching team.`
  const fullBio =
    normalizeText(input.fullBio ?? existing?.full_bio, 'Full bio', { max: 5000 }) ||
    description

  return {
    id:
      existing?.id ||
      normalizeOptionalText(input.id, 120) ||
      `sensei_${randomUUID().replace(/-/g, '')}`,
    slug,
    name,
    title,
    dan,
    role,
    specialty: normalizeText(
      input.specialty ?? existing?.specialty ?? 'Karate Instruction',
      'Specialty',
      { required: true, max: 160 }
    ),
    experience: normalizeText(input.experience ?? existing?.experience, 'Experience', {
      max: 160,
    }),
    description,
    full_bio: fullBio,
    achievements: normalizeAchievements(input.achievements ?? input.achievementsText ?? existing?.achievements),
    quote: normalizeText(input.quote ?? existing?.quote, 'Quote', { max: 500 }),
    image_url:
      normalizeText(input.imageUrl ?? existing?.image_url, 'Image URL', { max: 500 }) ||
      DEFAULT_IMAGE,
    accent_color: normalizeAccent(input.accent ?? existing?.accent_color),
    is_founder: normalizeBoolean(input.isFounder, existing?.is_founder || false),
    is_executive_committee: normalizeBoolean(
      input.isExecutiveCommittee,
      existing?.is_executive_committee || false
    ),
    is_public: normalizeBoolean(input.isPublic, existing?.is_public !== false),
    is_active: normalizeBoolean(input.isActive, existing?.is_active !== false),
    is_assignable: normalizeBoolean(input.isAssignable, existing?.is_assignable !== false),
    sort_order: normalizeSortOrder(input.sortOrder, existing?.sort_order || 0),
  }
}

export async function createSenseiLive(input: Partial<SenseiProfile> & { achievementsText?: string }) {
  ensureSupabaseForSenseisAdmin()
  const payload = await prepareSenseiUpsertPayload(input)

  const { error } = await supabaseAdmin.from('senseis').insert(payload)

  if (error) {
    handleSenseiWriteError(error, 'Sensei')
  }

  return getSenseiByIdLive(payload.id)
}

export async function updateSenseiLive(
  id: string,
  input: Partial<SenseiProfile> & { achievementsText?: string }
) {
  ensureSupabaseForSenseisAdmin()

  const { data: row, error: readError } = await supabaseAdmin
    .from('senseis')
    .select('*')
    .eq('id', id)
    .single()

  if (readError?.code === 'PGRST116') return null
  if (readError) handleSenseiWriteError(readError, 'Sensei')

  const existing = row as SenseiRow
  const payload = await prepareSenseiUpsertPayload(input, existing)

  const { error } = await supabaseAdmin
    .from('senseis')
    .update({
      ...payload,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (error) {
    handleSenseiWriteError(error, 'Sensei')
  }

  if (payload.name !== existing.name || payload.dan !== existing.dan) {
    const { error: branchSyncError } = await supabaseAdmin
      .from('class_branches')
      .update({
        sensei: payload.name,
        sensei_dan: payload.dan,
        updated_at: new Date().toISOString(),
      })
      .eq('lead_sensei_id', id)

    if (branchSyncError && branchSyncError.code !== 'PGRST205') {
      handleSenseiWriteError(branchSyncError, 'Sensei')
    }
  }

  return getSenseiByIdLive(id)
}

export async function deleteSenseiLive(id: string) {
  ensureSupabaseForSenseisAdmin()

  const { count, error: usageError } = await supabaseAdmin
    .from('class_branches')
    .select('slug', { count: 'exact', head: true })
    .eq('lead_sensei_id', id)

  if (usageError && usageError.code !== 'PGRST205') {
    handleSenseiWriteError(usageError, 'Sensei')
  }

  if ((count || 0) > 0) {
    throw new ApiError(
      409,
      'This Sensei is still assigned to one or more branches. Reassign those branches before deleting the Sensei.'
    )
  }

  const { error } = await supabaseAdmin.from('senseis').delete().eq('id', id)

  if (error) {
    handleSenseiWriteError(error, 'Sensei')
  }

  return true
}

export async function syncStaticSenseisToLive(options: { replace?: boolean } = {}) {
  ensureSupabaseForSenseisAdmin()

  const replace = Boolean(options.replace)
  const senseis = buildStaticSenseiDataset()

  const rows = senseis.map((sensei) => ({
    id: sensei.id,
    slug: sensei.slug,
    name: sensei.name,
    title: sensei.title,
    dan: sensei.dan,
    role: sensei.role,
    specialty: sensei.specialty,
    experience: sensei.experience,
    description: sensei.description,
    full_bio: sensei.fullBio,
    achievements: sensei.achievements,
    quote: sensei.quote,
    image_url: sensei.imageUrl,
    accent_color: sensei.accent,
    is_founder: sensei.isFounder,
    is_executive_committee: sensei.isExecutiveCommittee,
    is_public: sensei.isPublic,
    is_active: sensei.isActive,
    is_assignable: sensei.isAssignable,
    sort_order: sensei.sortOrder,
  }))

  const { error: senseiError } = await supabaseAdmin
    .from('senseis')
    .upsert(rows, { onConflict: 'id' })
  if (senseiError) handleSenseiWriteError(senseiError, 'Sensei')

  const senseiByName = new Map(
    senseis.map((sensei) => [normalizePersonKey(sensei.name), sensei])
  )

  const branchUpdates = staticCities
    .flatMap((city) =>
      city.branches
        .map((branch) => {
          const matchedSensei = senseiByName.get(normalizePersonKey(branch.sensei))
          if (!matchedSensei) return null

          return {
            slug: branch.slug,
            lead_sensei_id: matchedSensei.id,
            sensei: matchedSensei.name,
            sensei_dan: matchedSensei.dan,
            updated_at: new Date().toISOString(),
          }
        })
        .filter(<T>(item: T | null): item is T => item !== null)
    )

  if (branchUpdates.length > 0) {
    const { error: branchError } = await supabaseAdmin
      .from('class_branches')
      .upsert(branchUpdates, { onConflict: 'slug' })
    if (branchError) handleSenseiWriteError(branchError, 'Sensei assignment')
  }

  if (replace) {
    const ids = rows.map((row) => row.id)
    if (ids.length > 0) {
      await supabaseAdmin
        .from('senseis')
        .delete()
        .not('id', 'in', `(${ids.map((id) => `"${id}"`).join(',')})`)
    }
  }

  return getAllSenseisLive()
}

export function toSenseiSummary(sensei: SenseiProfile | null | undefined): SenseiSummary | null {
  if (!sensei) return null

  return {
    id: sensei.id,
    slug: sensei.slug,
    name: sensei.name,
    title: sensei.title,
    dan: sensei.dan,
    role: sensei.role,
    specialty: sensei.specialty,
    description: sensei.description,
    imageUrl: sensei.imageUrl,
    objectPosition: sensei.objectPosition,
    hidePhoto: sensei.hidePhoto,
    accent: sensei.accent,
    isPublic: sensei.isPublic,
    isActive: sensei.isActive,
    isAssignable: sensei.isAssignable,
  }
}
