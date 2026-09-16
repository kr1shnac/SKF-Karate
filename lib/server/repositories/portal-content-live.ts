import { randomUUID } from 'node:crypto'
import { cache } from 'react'

import { BELTS } from '@/data/constants/belts'

import { ApiError } from '@/lib/server/api'
import { isPublicTechniqueVideosEnabled } from '@/lib/server/feature-flags'
import { isSupabaseReady, supabaseAdmin } from '@/lib/server/supabase'
import { extractYouTubeId, getYouTubeThumbnailUrl, YOUTUBE_ID_PATTERN } from '@/lib/youtube'
import { cached, claimThrottleMarker, invalidateCache } from '@/src/server/lib/cache'
import { WATCHED_THRESHOLD } from '@/src/server/services/recommend-practice-video'
import { logger } from '@/src/server/lib/logger'

import { getAllCitiesLive } from './classes-live'

type PortalVideoRow = {
  id?: unknown
  title?: unknown
  description?: unknown
  lesson_note?: unknown
  category?: unknown
  duration_label?: unknown
  youtube_id?: unknown
  content_format?: unknown
  folder_id?: unknown
  branch_slugs?: unknown
  batch_names?: unknown
  belt_levels?: unknown
  is_featured?: unknown
  is_published?: unknown
  show_in_techniques?: unknown
  sort_order?: unknown
  created_at?: unknown
  updated_at?: unknown
}

type PracticeFolderRow = {
  id?: unknown
  parent_folder_id?: unknown
  title?: unknown
  description?: unknown
  cover_image_url?: unknown
  branch_slugs?: unknown
  batch_names?: unknown
  belt_levels?: unknown
  is_featured?: unknown
  is_published?: unknown
  sort_order?: unknown
  created_at?: unknown
  updated_at?: unknown
}

type PracticePhotoRow = {
  id?: unknown
  folder_id?: unknown
  title?: unknown
  description?: unknown
  storage_path?: unknown
  branch_slugs?: unknown
  batch_names?: unknown
  belt_levels?: unknown
  is_published?: unknown
  sort_order?: unknown
  created_at?: unknown
  updated_at?: unknown
}

type TimetableRow = {
  id?: unknown
  branch_slug?: unknown
  title?: unknown
  drive_url?: unknown
  image_url?: unknown
  month_label?: unknown
  effective_from?: unknown
  effective_to?: unknown
  is_active?: unknown
  notes?: unknown
  created_at?: unknown
  updated_at?: unknown
}

type PortalVideoPayload = {
  id?: unknown
  title?: unknown
  description?: unknown
  lessonNote?: unknown
  lesson_note?: unknown
  category?: unknown
  durationLabel?: unknown
  duration_label?: unknown
  youtubeId?: unknown
  youtube_id?: unknown
  youtubeInput?: unknown
  youtube_input?: unknown
  contentFormat?: unknown
  content_format?: unknown
  folderId?: unknown
  folder_id?: unknown
  branchSlugs?: unknown
  branch_slugs?: unknown
  batchNames?: unknown
  batch_names?: unknown
  beltLevels?: unknown
  belt_levels?: unknown
  isFeatured?: unknown
  isPublished?: unknown
  showInTechniques?: unknown
  show_in_techniques?: unknown
  sortOrder?: unknown
}

type PracticeFolderPayload = {
  id?: unknown
  parentFolderId?: unknown
  parent_folder_id?: unknown
  title?: unknown
  description?: unknown
  coverImageUrl?: unknown
  cover_image_url?: unknown
  branchSlugs?: unknown
  branch_slugs?: unknown
  batchNames?: unknown
  batch_names?: unknown
  beltLevels?: unknown
  belt_levels?: unknown
  isFeatured?: unknown
  isPublished?: unknown
  sortOrder?: unknown
}

type PracticePhotoPayload = {
  id?: unknown
  folderId?: unknown
  folder_id?: unknown
  title?: unknown
  description?: unknown
  storagePath?: unknown
  storage_path?: unknown
  branchSlugs?: unknown
  branch_slugs?: unknown
  batchNames?: unknown
  batch_names?: unknown
  beltLevels?: unknown
  belt_levels?: unknown
  isPublished?: unknown
  sortOrder?: unknown
}

type BranchTimetablePayload = {
  id?: unknown
  branchSlug?: unknown
  branch_slug?: unknown
  title?: unknown
  driveUrl?: unknown
  drive_url?: unknown
  imageUrl?: unknown
  image_url?: unknown
  monthLabel?: unknown
  month_label?: unknown
  effectiveFrom?: unknown
  effective_from?: unknown
  effectiveTo?: unknown
  effective_to?: unknown
  isActive?: unknown
  notes?: unknown
}

type DatabaseWriteError = {
  code?: string
  message?: string
}

export type PortalVideoRecord = {
  id: string
  title: string
  description: string
  lessonNote: string
  category: string
  durationLabel: string
  youtubeId: string
  contentFormat: 'landscape' | 'short'
  folderId: string
  thumbnailUrl: string
  branchSlugs: string[]
  batchNames: string[]
  beltLevels: string[]
  isFeatured: boolean
  isPublished: boolean
  showInTechniques: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type PracticeFolderRecord = {
  id: string
  parentFolderId: string
  title: string
  description: string
  coverImageUrl: string
  branchSlugs: string[]
  batchNames: string[]
  beltLevels: string[]
  isFeatured: boolean
  isPublished: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type AthletePracticeFolderRecord = PracticeFolderRecord & {
  videos: PortalVideoRecord[]
}

export type PracticePhotoRecord = {
  id: string
  folderId: string
  title: string
  description: string
  storagePath: string
  branchSlugs: string[]
  batchNames: string[]
  beltLevels: string[]
  isPublished: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type AthletePracticePhotoRecord = PracticePhotoRecord & { imageUrl: string }

export type AthletePortalVideoRecord = PortalVideoRecord

export type BranchTimetableRecord = {
  id: string
  branchSlug: string
  title: string
  driveUrl: string
  imageUrl: string
  monthLabel: string
  effectiveFrom: string
  effectiveTo: string
  isActive: boolean
  notes: string
  createdAt: string
  updatedAt: string
}

function slugify(value: string) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

function normalizeTextList(values: unknown): string[] {
  return Array.isArray(values)
    ? values
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean)
    : []
}

function normalizeBeltLevel(value?: string | null) {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return ''
  const key = normalized
    .replace(/\bbelt\b/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
  if (key.startsWith('black')) return 'black'

  const aliases: Record<string, string> = {
    white: 'white',
    yellow: 'yellow',
    orange: 'orange',
    'green-ii': 'green-ii',
    'green-i': 'green-i',
    blue: 'blue',
    purple: 'purple',
    'brown-iii': 'brown-iii',
    'brown-ii': 'brown-ii',
    'brown-i': 'brown-i',
  }
  return aliases[key] || key
}

function mapPortalVideoRow(row: PortalVideoRow): PortalVideoRecord {
  const youtubeId = String(row.youtube_id || '').trim()

  return {
    id: String(row.id),
    title: String(row.title || '').trim(),
    description: String(row.description || '').trim(),
    lessonNote: String(row.lesson_note || '').trim(),
    category: String(row.category || 'techniques').trim().toLowerCase(),
    durationLabel: String(row.duration_label || '').trim(),
    youtubeId,
    contentFormat: String(row.content_format || '').trim().toLowerCase() === 'short' ? 'short' : 'landscape',
    folderId: String(row.folder_id || '').trim(),
    thumbnailUrl: youtubeId ? getYouTubeThumbnailUrl(youtubeId) : '',
    branchSlugs: normalizeTextList(row.branch_slugs),
    batchNames: normalizeTextList(row.batch_names),
    beltLevels: normalizeTextList(row.belt_levels).map((belt) => normalizeBeltLevel(belt)),
    isFeatured: Boolean(row.is_featured),
    isPublished: Boolean(row.is_published),
    showInTechniques: Boolean(row.show_in_techniques),
    sortOrder: Number(row.sort_order || 0),
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
  }
}

function mapPracticeFolderRow(row: PracticeFolderRow): PracticeFolderRecord {
  return {
    id: String(row.id || '').trim(),
    parentFolderId: String(row.parent_folder_id || '').trim(),
    title: String(row.title || '').trim(),
    description: String(row.description || '').trim(),
    coverImageUrl: String(row.cover_image_url || '').trim(),
    branchSlugs: normalizeTextList(row.branch_slugs),
    batchNames: normalizeTextList(row.batch_names),
    beltLevels: normalizeTextList(row.belt_levels).map((belt) => normalizeBeltLevel(belt)),
    isFeatured: Boolean(row.is_featured),
    isPublished: Boolean(row.is_published),
    sortOrder: Number(row.sort_order || 0),
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
  }
}

function mapPracticePhotoRow(row: PracticePhotoRow): PracticePhotoRecord {
  return {
    id: String(row.id || '').trim(),
    folderId: String(row.folder_id || '').trim(),
    title: String(row.title || '').trim(),
    description: String(row.description || '').trim(),
    storagePath: String(row.storage_path || '').trim(),
    branchSlugs: normalizeTextList(row.branch_slugs),
    batchNames: normalizeTextList(row.batch_names),
    beltLevels: normalizeTextList(row.belt_levels).map((belt) => normalizeBeltLevel(belt)),
    isPublished: Boolean(row.is_published),
    sortOrder: Number(row.sort_order || 0),
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
  }
}

function mapTimetableRow(row: TimetableRow): BranchTimetableRecord {
  return {
    id: String(row.id),
    branchSlug: String(row.branch_slug || '').trim(),
    title: String(row.title || 'Official Timetable').trim(),
    driveUrl: String(row.drive_url || '').trim(),
    imageUrl: String(row.image_url || '').trim(),
    monthLabel: String(row.month_label || '').trim(),
    effectiveFrom: String(row.effective_from || '').trim(),
    effectiveTo: String(row.effective_to || '').trim(),
    isActive: Boolean(row.is_active),
    notes: String(row.notes || '').trim(),
    createdAt: String(row.created_at || new Date().toISOString()),
    updatedAt: String(row.updated_at || new Date().toISOString()),
  }
}

function handlePortalContentError(error: DatabaseWriteError, entityLabel: string): never {
  if (error?.code === 'PGRST205') {
    const migrationHint = entityLabel.startsWith('portal_practice_')
      ? ' Run database/migrations/043_portal_practice_folders.sql in the connected Supabase project.'
      : ' Run database/schema.sql in the connected Supabase project.'
    throw new ApiError(
      500,
      `Supabase schema is incomplete: missing "${entityLabel}" table.${migrationHint}`
    )
  }

  throw new ApiError(500, error?.message || `Unable to persist ${entityLabel}.`)
}

function ensureSupabaseForPortalContent() {
  if (!isSupabaseReady()) {
    throw new ApiError(503, 'Supabase is not configured for portal content.')
  }
}

function normalisePortalVideoPayload(payload: PortalVideoPayload) {
  const title = String(payload.title || '').trim()
  const youtubeId = extractYouTubeId(
    String(
      payload.youtubeId ||
        payload.youtube_id ||
        payload.youtubeInput ||
        payload.youtube_input ||
        ''
    )
  )

  if (!title) {
    throw new ApiError(400, 'Video title is required.')
  }

  if (!youtubeId || !YOUTUBE_ID_PATTERN.test(youtubeId)) {
    throw new ApiError(400, 'A valid 11-character YouTube video ID is required.')
  }

  const branchSlugs = normalizeTextList(payload.branchSlugs || payload.branch_slugs)
  const batchNames = normalizeTextList(payload.batchNames || payload.batch_names)
  const showInTechniques = Boolean(payload.showInTechniques ?? payload.show_in_techniques)
  const youtubeInput = String(payload.youtubeInput || payload.youtube_input || '')
  const requestedFormat = String(payload.contentFormat || payload.content_format || '').trim().toLowerCase()
  const contentFormat = requestedFormat === 'short' || (!requestedFormat && /youtube\.com\/shorts\//i.test(youtubeInput))
    ? 'short'
    : 'landscape'

  if (showInTechniques && (branchSlugs.length || batchNames.length)) {
    throw new ApiError(
      400,
      'Public technique library videos must stay global. Remove branch and batch restrictions before enabling the technique library toggle.'
    )
  }

  const folderId = String(payload.folderId || payload.folder_id || '').trim()

  return {
    id: String(payload.id || `${slugify(title) || 'video'}-${randomUUID().slice(0, 8)}`).trim(),
    title,
    description: String(payload.description || '').trim(),
    lesson_note: String(payload.lessonNote || payload.lesson_note || '').trim().slice(0, 3000),
    category: String(payload.category || 'techniques').trim().toLowerCase() || 'techniques',
    duration_label: String(payload.durationLabel || payload.duration_label || '').trim(),
    youtube_id: youtubeId,
    content_format: contentFormat,
    folder_id: folderId || null,
    branch_slugs: branchSlugs,
    batch_names: batchNames,
    belt_levels: normalizeTextList(payload.beltLevels || payload.belt_levels).map((belt) => normalizeBeltLevel(belt)),
    is_featured: Boolean(payload.isFeatured),
    is_published: payload.isPublished === undefined ? true : Boolean(payload.isPublished),
    show_in_techniques: showInTechniques,
    sort_order: Number(payload.sortOrder || 0),
    updated_at: new Date().toISOString(),
  }
}

function normalisePracticeFolderPayload(payload: PracticeFolderPayload) {
  const title = String(payload.title || '').trim()
  if (!title) throw new ApiError(400, 'Folder title is required.')

  return {
    id: String(payload.id || `${slugify(title) || 'practice'}-${randomUUID().slice(0, 8)}`).trim(),
    parent_folder_id: String(payload.parentFolderId || payload.parent_folder_id || '').trim() || null,
    title,
    description: String(payload.description || '').trim(),
    cover_image_url: String(payload.coverImageUrl || payload.cover_image_url || '').trim(),
    branch_slugs: normalizeTextList(payload.branchSlugs || payload.branch_slugs),
    batch_names: normalizeTextList(payload.batchNames || payload.batch_names),
    belt_levels: normalizeTextList(payload.beltLevels || payload.belt_levels).map((belt) => normalizeBeltLevel(belt)),
    is_featured: Boolean(payload.isFeatured),
    is_published: payload.isPublished === undefined ? true : Boolean(payload.isPublished),
    sort_order: Number(payload.sortOrder || 0),
    updated_at: new Date().toISOString(),
  }
}

function normalisePracticePhotoPayload(payload: PracticePhotoPayload) {
  const title = String(payload.title || '').trim()
  const storagePath = String(payload.storagePath || payload.storage_path || '').trim()
  if (!title) throw new ApiError(400, 'Photo title is required.')
  if (!storagePath) throw new ApiError(400, 'Photo storage path is required.')
  return {
    id: String(payload.id || `${slugify(title) || 'practice-photo'}-${randomUUID().slice(0, 8)}`).trim(),
    folder_id: String(payload.folderId || payload.folder_id || '').trim() || null,
    title,
    description: String(payload.description || '').trim(),
    storage_path: storagePath,
    branch_slugs: normalizeTextList(payload.branchSlugs || payload.branch_slugs),
    batch_names: normalizeTextList(payload.batchNames || payload.batch_names),
    belt_levels: normalizeTextList(payload.beltLevels || payload.belt_levels).map((belt) => normalizeBeltLevel(belt)),
    is_published: payload.isPublished === undefined ? true : Boolean(payload.isPublished),
    sort_order: Number(payload.sortOrder || 0),
    updated_at: new Date().toISOString(),
  }
}

/**
 * Partial-update overrides for practice content. Only the audience dimensions
 * (and sort order) the payload actually sends are written back — an edit that
 * omits branch, batch, belt, or sortOrder leaves the stored value untouched so
 * selections and drag ordering are never wiped by a rename/description change.
 * Sending an explicit empty array clears a dimension.
 */
function pickPracticeUpdateOverrides(payload: Record<string, unknown>) {
  const overrides: Record<string, unknown> = {}
  if ('branchSlugs' in payload || 'branch_slugs' in payload) {
    overrides.branch_slugs = normalizeTextList(payload.branchSlugs === undefined ? payload.branch_slugs : payload.branchSlugs)
  }
  if ('batchNames' in payload || 'batch_names' in payload) {
    overrides.batch_names = normalizeTextList(payload.batchNames === undefined ? payload.batch_names : payload.batchNames)
  }
  if ('beltLevels' in payload || 'belt_levels' in payload) {
    const raw = payload.beltLevels === undefined ? payload.belt_levels : payload.beltLevels
    overrides.belt_levels = normalizeTextList(raw).map((belt) => normalizeBeltLevel(belt))
  }
  if ('sortOrder' in payload || 'sort_order' in payload) {
    const raw = payload.sortOrder === undefined ? payload.sort_order : payload.sortOrder
    overrides.sort_order = Number(raw) || 0
  }
  return overrides
}

function applyPracticeUpdateOverrides(normalized: Record<string, unknown>, payload: Record<string, unknown>) {
  const update: Record<string, unknown> = { ...normalized }
  for (const key of ['branch_slugs', 'batch_names', 'belt_levels', 'sort_order']) delete update[key]
  Object.assign(update, pickPracticeUpdateOverrides(payload))
  return update
}

function normaliseBranchTimetablePayload(payload: BranchTimetablePayload) {
  const branchSlug = String(payload.branchSlug || payload.branch_slug || '').trim()
  const driveUrl = String(payload.driveUrl || payload.drive_url || '').trim()

  if (!branchSlug) {
    throw new ApiError(400, 'Branch is required for the timetable.')
  }

  if (!driveUrl) {
    throw new ApiError(400, 'Drive URL is required for the timetable.')
  }

  return {
    id: String(payload.id || '').trim() || randomUUID(),
    branch_slug: branchSlug,
    title: String(payload.title || 'Official Timetable').trim() || 'Official Timetable',
    drive_url: driveUrl,
    image_url: String(payload.imageUrl || payload.image_url || '').trim() || null,
    month_label: String(payload.monthLabel || payload.month_label || '').trim() || null,
    effective_from: String(payload.effectiveFrom || payload.effective_from || '').trim() || null,
    effective_to: String(payload.effectiveTo || payload.effective_to || '').trim() || null,
    is_active: payload.isActive === undefined ? true : Boolean(payload.isActive),
    notes: String(payload.notes || '').trim(),
    updated_at: new Date().toISOString(),
  }
}

/**
 * Resolve an athlete's branch name/slug to the `class_branches.slug` used by
 * practice content. This replaces the full 4-table `getAllCitiesLive()` read on
 * the practice library path with a tiny `(slug, name)` projection that is
 * coalesced in Redis for an hour and de-duplicated per request, so the home
 * practice page no longer pays for the complete class/school/sensei dataset on
 * every visit. Matching semantics are identical to
 * `findClassBranchByName`/`findClassBranchBySlug` (trimmed, case-insensitive).
 */
const branchSlugCandidates = cache(async function branchSlugCandidates(): Promise<
  Array<{ slug: string; name: string }>
> {
  if (isSupabaseReady()) {
    return cached('portal:branch-slug-candidates', 3600, async () => {
      const { data, error } = await supabaseAdmin
        .from('class_branches')
        .select('slug,name')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true })
      if (error) {
        logger.warn('portal_content.branch_candidates_load_failed', { error })
        throw error
      }
      return (data || []).map((row) => ({
        slug: String(row.slug),
        name: String(row.name),
      }))
    })
  }

  const cities = await getAllCitiesLive()
  return cities.flatMap((city) =>
    city.branches.map((branch) => ({
      slug: String(branch.slug),
      name: String(branch.name),
    }))
  )
})

const resolveBranchSlugForName = cache(async function resolveBranchSlugForName(branchName?: string | null) {
  if (!branchName) return ''
  const normalizedBranch = String(branchName).trim().toLowerCase()

  const candidates = await branchSlugCandidates()

  const matchByRule = (normalize: (value: string) => string, candidate: string) =>
    normalize(candidate) === normalizedBranch
  const normalizeName = (value: string) => String(value).trim().toLowerCase()

  const byName = candidates.find((candidate) => matchByRule(normalizeName, candidate.name))
  if (byName) return byName.slug

  const normalizeSlug = (value: string) => String(value).trim().toLowerCase()
  const bySlug = candidates.find((candidate) => matchByRule(normalizeSlug, candidate.slug))
  if (bySlug) return bySlug.slug

  return slugify(branchName)
})

type PracticeAudience = {
  branchSlugs: string[]
  batchNames: string[]
  beltLevels: string[]
}

type AthletePracticeAudience = { branchSlug: string; batch: string; belt: string }

export function practiceAudienceMatches(
  _audience: PracticeAudience,
  _context: AthletePracticeAudience
) {
  // IMPROVISATION: The client requested that ALL published content be visible to ALL athletes
  // so they can practice everything without restrictions.
  // We return true here to bypass the belt/branch/batch filters completely.
  return true
}

function matchesVideoAudience(video: PortalVideoRecord, context: AthletePracticeAudience) {
  return practiceAudienceMatches(video, context)
}

const BELT_RANK = new Map(BELTS.map((belt, index) => [belt.colour, index]))

/**
 * Ranking rule that drives the practice shelf order: content with no belt
 * restriction is general and leads; belt-specific content then climbs from
 * White to Black. Collisions fall back to featured → drag sort order → title.
 */
function beltSortRank(beltLevels: unknown[] | undefined) {
  const ranks = (beltLevels || []).map((level) => BELT_RANK.get(normalizeBeltLevel(level as string)) ?? 99)
  if (!ranks.length) return -1
  return Math.min(...ranks)
}

function sortPortalVideos(videos: PortalVideoRecord[]) {
  return [...videos].sort((a, b) => {
    const beltDiff = beltSortRank(a.beltLevels) - beltSortRank(b.beltLevels)
    if (beltDiff !== 0) return beltDiff

    const featuredDiff = Number(b.isFeatured) - Number(a.isFeatured)
    if (featuredDiff !== 0) return featuredDiff

    const orderDiff = Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
    if (orderDiff !== 0) return orderDiff

    return a.title.localeCompare(b.title)
  })
}

function sortPracticeFolders(folders: PracticeFolderRecord[]) {
  return [...folders].sort((a, b) => {
    const featuredDiff = Number(b.isFeatured) - Number(a.isFeatured)
    if (featuredDiff !== 0) return featuredDiff
    const orderDiff = a.sortOrder - b.sortOrder
    if (orderDiff !== 0) return orderDiff
    return a.title.localeCompare(b.title)
  })
}

export async function getAllPortalVideosAdmin() {
  if (!isSupabaseReady()) return []

  return cached<PortalVideoRecord[]>('portal:videos:all', 60, async () => {
    const { data, error } = await supabaseAdmin
      .from('portal_videos')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true })

    if (error) {
      logger.warn('portal_content.videos_load_failed', { error })
      throw error
    }
    return sortPortalVideos((data || []).map(mapPortalVideoRow))
  })
}

export async function getAllPracticeFoldersAdmin() {
  if (!isSupabaseReady()) return []

  return cached<PracticeFolderRecord[]>('portal:folders:all', 60, async () => {
    const { data, error } = await supabaseAdmin
      .from('portal_practice_folders')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true })

    if (error) {
      logger.warn('portal_content.practice_folders_load_failed', { error })
      throw error
    }
    return (data || []).map(mapPracticeFolderRow)
  })
}

export async function getAllPracticePhotosAdmin() {
  if (!isSupabaseReady()) return []

  return cached<PracticePhotoRecord[]>('portal:photos:all', 60, async () => {
    const { data, error } = await supabaseAdmin
      .from('portal_practice_photos')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('title', { ascending: true })
    if (error) {
      logger.warn('portal_content.practice_photos_load_failed', { error })
      throw error
    }
    return (data || []).map(mapPracticePhotoRow)
  })
}

export async function getPortalVideosForAthlete(context: {
  branchName?: string | null
  batch?: string | null
  belt?: string | null
}) {
  const allVideos = await getAllPortalVideosAdmin()
  const branchSlug = await resolveBranchSlugForName(context.branchName)
  const batch = String(context.batch || '').trim().toLowerCase()
  const belt = normalizeBeltLevel(context.belt)

  return sortPortalVideos(
    allVideos.filter(
      (video) =>
        video.isPublished &&
        matchesVideoAudience(video, {
          branchSlug,
          batch,
          belt,
        })
    )
  )
}

export async function getProtectedPortalVideosForAthlete(context: {
  branchName?: string | null
  batch?: string | null
  belt?: string | null
}) {
  return getPortalVideosForAthlete(context)
}

/**
 * Folders are organisational shelves. They never gate content by branch,
 * batch, or belt: a lesson shown through a folder is decided solely by the
 * lesson's own audience. A folder only needs to be published (along with its
 * ancestor chain) for its content to appear.
 */
export async function getPracticeLibraryForAthlete(context: {
  branchName?: string | null
  batch?: string | null
  belt?: string | null
}): Promise<{ folders: Array<AthletePracticeFolderRecord & { photos: AthletePracticePhotoRecord[] }>; unfiledVideos: PortalVideoRecord[]; unfiledPhotos: AthletePracticePhotoRecord[] }> {
  const [allFolders, allVideos, allPhotos] = await Promise.all([
    getAllPracticeFoldersAdmin(),
    getAllPortalVideosAdmin(),
    getAllPracticePhotosAdmin(),
  ])
  const audience = {
    branchSlug: await resolveBranchSlugForName(context.branchName),
    batch: String(context.batch || '').trim().toLowerCase(),
    belt: normalizeBeltLevel(context.belt),
  }

  const folderById = new Map(allFolders.map((folder) => [folder.id, folder]))
  const folderAndAncestorsPublished = (folder: PracticeFolderRecord) => {
    const visited = new Set<string>()
    let current: PracticeFolderRecord | undefined = folder
    while (current) {
      if (visited.has(current.id) || !current.isPublished) return false
      visited.add(current.id)
      current = current.parentFolderId ? folderById.get(current.parentFolderId) : undefined
    }
    return true
  }

  /**
   * Availability modes for library content:
   * - 'audience': normal audience + folder gating. A broken (missing) folder
   *   reference never hides a published lesson — it surfaces as unfiled.
   * - 'fallback-all-published': emergency fallback that surfaces every published
   *   lesson regardless of audience or folder gating, so an athlete never sees
   *   an empty library when published content exists.
   */
  const visibleVideosFor = (mode: 'audience' | 'fallback-all-published') =>
    sortPortalVideos(
      allVideos
        .filter((video) => {
          if (!video.isPublished) return false
          if (mode === 'audience') {
            const folder = video.folderId ? folderById.get(video.folderId) : undefined
            if (video.folderId && !folder) return true
            if (video.folderId && folder && !folderAndAncestorsPublished(folder)) return false
            if (!matchesVideoAudience(video, audience)) return false
          }
          return true
        })
        .map((video) => {
          const folder = video.folderId ? folderById.get(video.folderId) : undefined
          if (video.folderId && folder && folderAndAncestorsPublished(folder)) return video
          return { ...video, folderId: '' }
        })
    )

  const visiblePhotosFor = (mode: 'audience' | 'fallback-all-published') =>
    allPhotos
      .filter((photo) => {
        if (!photo.isPublished) return false
        if (mode === 'audience') {
          const folder = photo.folderId ? folderById.get(photo.folderId) : undefined
          if (photo.folderId && !folder) return true
          if (photo.folderId && folder && !folderAndAncestorsPublished(folder)) return false
          if (!matchesPracticePhotoAudience(photo, audience)) return false
        }
        return true
      })
      .map((photo) => {
        const folder = photo.folderId ? folderById.get(photo.folderId) : undefined
        if (photo.folderId && folder && folderAndAncestorsPublished(folder)) return photo
        return { ...photo, folderId: '' }
      })

  const visibleFolders = sortPracticeFolders(allFolders.filter(folderAndAncestorsPublished))

  let visibleVideos = visibleVideosFor('audience')
  let visiblePhotos = visiblePhotosFor('audience')
  let usedFallback = false

  const publishedVideosExist = allVideos.some((video) => video.isPublished)
  const publishedPhotosExist = allPhotos.some((photo) => photo.isPublished)

  const videoVisibilityReasons = allVideos.map((video) => {
    if (!video.isPublished) return 'unpublished'
    const folder = video.folderId ? folderById.get(video.folderId) : undefined
    if (video.folderId && !folder) return 'folder-missing'
    if (video.folderId && folder && !folderAndAncestorsPublished(folder)) return 'folder-unpublished'
    if (!matchesVideoAudience(video, audience)) return 'audience'
    return 'visible'
  })
  const countReasons = (reasons: string[]) =>
    reasons.reduce<Record<string, number>>((acc, reason) => {
      const key = reason || 'visible'
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})

  // If audience + folder gating left nothing visible but published content
  // exists, surface everything published so the library is never empty.
  if (visibleVideos.length === 0 && visiblePhotos.length === 0 && (publishedVideosExist || publishedPhotosExist)) {
    usedFallback = true
    const alertKey = `portal:alert:fallback:${String(context.branchName || '')}:${String(context.batch || '')}:${String(context.belt || '')}:${new Date().toISOString().slice(0, 10)}`
    if (await claimThrottleMarker(alertKey, 24 * 60 * 60)) {
      logger.warn('portal_content.library_fallback_all_published', {
        inputContext: { branchName: context.branchName, batch: context.batch, belt: context.belt },
        resolvedAudience: audience,
        rawCounts: { folders: allFolders.length, videos: allVideos.length, photos: allPhotos.length },
        videoVisibility: countReasons(videoVisibilityReasons),
      })
    }
    visibleVideos = visibleVideosFor('fallback-all-published')
    visiblePhotos = visiblePhotosFor('fallback-all-published')
  }
  const availablePhotos = visiblePhotos.map((photo): AthletePracticePhotoRecord => ({
    ...photo,
    imageUrl: `/api/portal/photos/${photo.id}`
  }))

  const foldersWithContents = visibleFolders
    .map((folder) => ({
      ...folder,
      videos: visibleVideos.filter((video) => video.folderId === folder.id),
      photos: availablePhotos.filter((photo) => photo.folderId === folder.id),
    }))

  // Keep empty parent folders when they organise visible child sections.
  // This preserves a syllabus hierarchy such as Kumite > Techniques.
  const includedFolderIds = new Set(foldersWithContents
    .filter((folder) => folder.videos.length > 0 || folder.photos.length > 0)
    .map((folder) => folder.id))
  let hierarchyChanged = true
  while (hierarchyChanged) {
    hierarchyChanged = false
    for (const folder of foldersWithContents) {
      if (includedFolderIds.has(folder.id) && folder.parentFolderId && !includedFolderIds.has(folder.parentFolderId)) {
        includedFolderIds.add(folder.parentFolderId)
        hierarchyChanged = true
      }
    }
  }
  const folders = foldersWithContents.filter((folder) => includedFolderIds.has(folder.id))

  const unfiledVideos = visibleVideos.filter((video) => !video.folderId)
  const unfiledPhotos = availablePhotos.filter((photo) => !photo.folderId)

  if (!folders.length && !unfiledVideos.length && !unfiledPhotos.length) {
    const publishedVideoCount = allVideos.filter(v => v.isPublished).length
    const sampleVideoRestrictions = allVideos.slice(0, 5).map(v => ({
      id: v.id,
      title: v.title,
      published: v.isPublished,
      branchSlugs: v.branchSlugs,
      batchNames: v.batchNames,
      beltLevels: v.beltLevels,
      folderId: v.folderId,
    }))
    const emptyAlertKey = `portal:alert:empty:${String(context.branchName || '')}:${String(context.batch || '')}:${String(context.belt || '')}:${new Date().toISOString().slice(0, 10)}`
    if (await claimThrottleMarker(emptyAlertKey, 24 * 60 * 60)) {
      logger.warn('portal_content.library_empty_for_athlete', {
        inputContext: { branchName: context.branchName, batch: context.batch, belt: context.belt },
        resolvedAudience: audience,
        rawCounts: { folders: allFolders.length, videos: allVideos.length, photos: allPhotos.length },
        publishedVideoCount,
        usedFallback,
        videoVisibility: countReasons(videoVisibilityReasons),
        visibleCounts: { folders: visibleFolders.length, videos: visibleVideos.length, photos: visiblePhotos.length },
        sampleVideoRestrictions,
      })
    }
  }

  return {
    folders,
    unfiledVideos,
    unfiledPhotos,
  }
}

/** Checks whether a folder and all its ancestors are published. */
async function getFolderWithAncestorsPublished(folderId: string): Promise<PracticeFolderRecord | null> {
  const allFolders = await getAllPracticeFoldersAdmin()
  const folderById = new Map(allFolders.map((folder) => [folder.id, folder]))
  const folder = folderById.get(folderId)
  if (!folder) return null

  const visited = new Set<string>()
  let current: PracticeFolderRecord | undefined = folder
  while (current) {
    if (visited.has(current.id) || !current.isPublished) return null
    visited.add(current.id)
    current = current.parentFolderId ? folderById.get(current.parentFolderId) : undefined
  }
  return folder
}

export type PracticeProgressDatum = {
  videoId: string
  progressPercent: number
  completed: boolean
  lastWatchedAt: string
}

/**
 * Siblings normally share one phone, so if any video in a folder was watched
 * (>= 80%) the whole folder reads as completed for that account. This is a
 * derived read-time view only — real progress rows are left untouched.
 */
export function applySharedPracticeCompletion(
  folders: Array<{ id: string; videos: Array<{ id: string }> }>,
  progressData: PracticeProgressDatum[]
): PracticeProgressDatum[] {
  if (!folders.length) return progressData

  const entryByVideoId = new Map(progressData.map((entry, index) => [String(entry.videoId), index]))
  const derived = progressData.slice()

  for (const folder of folders) {
    const members = (folder.videos || []).map((video) => String(video.id)).filter(Boolean)
    if (members.length < 2) continue

    const anyWatched = members.some((id) => {
      const index = entryByVideoId.get(id)
      return index !== undefined && derived[index].progressPercent >= WATCHED_THRESHOLD
    })
    if (!anyWatched) continue

    let sharedLatest = 0
    for (const id of members) {
      const index = entryByVideoId.get(id)
      if (index !== undefined) {
        const watchedAt = new Date(derived[index].lastWatchedAt || 0).getTime()
        if (Number.isFinite(watchedAt)) sharedLatest = Math.max(sharedLatest, watchedAt)
      }
    }

    const markerTime = (sharedLatest || Date.now())
    for (const id of members) {
      const index = entryByVideoId.get(id)
      if (index !== undefined) {
        derived[index] = { ...derived[index], progressPercent: 100, completed: true }
      } else {
        derived.push({
          videoId: id,
          progressPercent: 100,
          completed: true,
          lastWatchedAt: new Date(markerTime).toISOString(),
        })
      }
    }
  }

  return derived
}

/** Returns a single authorised lesson for a direct athlete-portal link. */
export async function getPracticeLessonForAthlete(
  videoId: string,
  context: { branchName?: string | null; batch?: string | null; belt?: string | null }
) {
  if (!isSupabaseReady()) {
    const library = await getPracticeLibraryForAthlete(context)
    return [...library.folders.flatMap((folder) => folder.videos), ...library.unfiledVideos]
      .find((entry) => entry.id === videoId) || null
  }

  const audience = {
    branchSlug: await resolveBranchSlugForName(context.branchName),
    batch: String(context.batch || '').trim().toLowerCase(),
    belt: normalizeBeltLevel(context.belt),
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('portal_videos')
      .select('*')
      .eq('id', videoId)
      .eq('is_published', true)
      .maybeSingle()

    if (error) throw error
    if (!data) return null

    const video = mapPortalVideoRow(data)
    const folderPublished = video.folderId
      ? Boolean(await getFolderWithAncestorsPublished(video.folderId))
      : true

    if (matchesVideoAudience(video, audience) && folderPublished) {
      return video
    }

    // Mirror the library's keep-published-content-visible rule: a published
    // lesson the athlete can already see in their home-practice library must
    // never turn into a 404 on its direct link, even when the strict audience
    // check or a broken folder reference would otherwise hide it.
    const library = await getPracticeLibraryForAthlete(context)
    const surfaced = [
      ...library.folders.flatMap((folder) => folder.videos),
      ...library.unfiledVideos,
    ].find((entry) => String(entry.id) === String(videoId))
    return surfaced ? video : null
  } catch (error) {
    logger.warn('portal_content.lesson_direct_query_failed', { videoId, error })
    const library = await getPracticeLibraryForAthlete(context)
    return [...library.folders.flatMap((folder) => folder.videos), ...library.unfiledVideos]
      .find((entry) => entry.id === videoId) || null
  }
}

/** Builds the published ancestor path (root → leaf) for a folder id. */
export async function getPracticeFolderPathForAthlete(folderId: string): Promise<Array<{ id: string; title: string }>> {
  if (!folderId) return []
  const allFolders = await getAllPracticeFoldersAdmin()
  const folderById = new Map(allFolders.map((folder) => [folder.id, folder]))
  const leaf = folderById.get(folderId)
  if (!leaf) return []

  const chain: Array<{ id: string; title: string }> = []
  const visited = new Set<string>()
  let current: PracticeFolderRecord | undefined = leaf
  while (current) {
    if (visited.has(current.id)) break
    visited.add(current.id)
    chain.unshift({ id: current.id, title: current.title })
    current = current.parentFolderId ? folderById.get(current.parentFolderId) : undefined
  }
  return chain
}

export async function getTechniqueLibraryVideos(filters: {
  beltLevel?: string | null
  category?: string | null
} = {}) {
  if (!isPublicTechniqueVideosEnabled()) {
    return []
  }

  const beltLevel = normalizeBeltLevel(filters.beltLevel)
  const category = String(filters.category || '').trim().toLowerCase()

  return sortPortalVideos(
    (await getAllPortalVideosAdmin()).filter((video) => {
      if (!video.isPublished || !video.showInTechniques) return false
      if (video.branchSlugs.length || video.batchNames.length) return false
      if (beltLevel && !video.beltLevels.includes(beltLevel)) return false
      if (category && video.category !== category) return false
      return true
    })
  )
}

export async function createPortalVideo(payload: PortalVideoPayload) {
  ensureSupabaseForPortalContent()
  const normalized = normalisePortalVideoPayload(payload)

  const { data, error } = await supabaseAdmin
    .from('portal_videos')
    .insert({
      ...normalized,
      created_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (error) handlePortalContentError(error, 'portal_videos')
  await invalidateCache('portal:videos:all')
  return mapPortalVideoRow(data)
}

export async function createPracticeFolder(payload: PracticeFolderPayload) {
  ensureSupabaseForPortalContent()
  const normalized = normalisePracticeFolderPayload(payload)
  await assertValidPracticeFolderParent(normalized.id, String(normalized.parent_folder_id || ''))
  const { data, error } = await supabaseAdmin
    .from('portal_practice_folders')
    .insert({ ...normalized, created_at: new Date().toISOString() })
    .select('*')
    .single()
  if (error) handlePortalContentError(error, 'portal_practice_folders')
  await invalidateCache('portal:folders:all')
  return mapPracticeFolderRow(data)
}

export async function updatePracticeFolder(id: string, payload: PracticeFolderPayload) {
  ensureSupabaseForPortalContent()
  const normalized = normalisePracticeFolderPayload({ ...payload, id })
  await assertValidPracticeFolderParent(id, String(normalized.parent_folder_id || ''))
  const update = applyPracticeUpdateOverrides(normalized, { ...payload, id })
  const { data, error } = await supabaseAdmin
    .from('portal_practice_folders')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()
  if (error) handlePortalContentError(error, 'portal_practice_folders')
  await invalidateCache('portal:folders:all')
  return mapPracticeFolderRow(data)
}

export async function deletePracticeFolder(id: string) {
  ensureSupabaseForPortalContent()
  const { error } = await supabaseAdmin.from('portal_practice_folders').delete().eq('id', id)
  if (error) handlePortalContentError(error, 'portal_practice_folders')
  await invalidateCache('portal:folders:all')
}

function matchesPracticePhotoAudience(photo: PracticePhotoRecord, context: AthletePracticeAudience) {
  return practiceAudienceMatches(photo, context)
}

export async function createPracticePhoto(payload: PracticePhotoPayload) {
  ensureSupabaseForPortalContent()
  const normalized = normalisePracticePhotoPayload(payload)
  const { data, error } = await supabaseAdmin
    .from('portal_practice_photos')
    .insert({ ...normalized, created_at: new Date().toISOString() })
    .select('*')
    .single()
  if (error) handlePortalContentError(error, 'portal_practice_photos')
  await invalidateCache('portal:photos:all')
  return mapPracticePhotoRow(data)
}

export async function deletePracticePhoto(id: string) {
  ensureSupabaseForPortalContent()
  const { data, error } = await supabaseAdmin.from('portal_practice_photos').delete().eq('id', id).select('storage_path').single()
  if (error) handlePortalContentError(error, 'portal_practice_photos')
  const storagePath = String(data?.storage_path || '').trim()
  if (storagePath) await supabaseAdmin.storage.from('portal-practice-images').remove([storagePath])
  await invalidateCache('portal:photos:all')
  await invalidateCache(`portal:photo_url:${id}`)
}

export async function updatePortalVideo(id: string, payload: PortalVideoPayload) {
  ensureSupabaseForPortalContent()

  const normalized = normalisePortalVideoPayload({
    ...payload,
    id,
  })

  const update = applyPracticeUpdateOverrides(normalized, { ...payload, id })

  const { data, error } = await supabaseAdmin
    .from('portal_videos')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()

  if (error) handlePortalContentError(error, 'portal_videos')
  await invalidateCache('portal:videos:all')
  return mapPortalVideoRow(data)
}

async function assertValidPracticeFolderParent(folderId: string, parentFolderId: string) {
  if (!parentFolderId) return
  if (folderId === parentFolderId) throw new ApiError(400, 'A folder cannot be inside itself.')
  const folders = await getAllPracticeFoldersAdmin()
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  let current = byId.get(parentFolderId)
  if (!current) throw new ApiError(400, 'Choose an existing parent folder.')
  const visited = new Set<string>()
  while (current) {
    if (current.id === folderId) throw new ApiError(400, 'A folder cannot be placed inside one of its own subfolders.')
    if (visited.has(current.id)) throw new ApiError(400, 'The folder hierarchy contains a cycle and must be corrected.')
    visited.add(current.id)
    current = current.parentFolderId ? byId.get(current.parentFolderId) : undefined
  }
}

export async function deletePortalVideo(id: string) {
  ensureSupabaseForPortalContent()
  const { error } = await supabaseAdmin.from('portal_videos').delete().eq('id', id)
  if (error) handlePortalContentError(error, 'portal_videos')
  await invalidateCache('portal:videos:all')
}

export type PracticeReorderScope = 'folders' | 'videos' | 'photos'

const PRACTICE_REORDER_TABLE: Record<PracticeReorderScope, string> = {
  folders: 'portal_practice_folders',
  videos: 'portal_videos',
  photos: 'portal_practice_photos',
}

const PRACTICE_REORDER_CACHE_KEY: Record<PracticeReorderScope, string> = {
  folders: 'portal:folders:all',
  videos: 'portal:videos:all',
  photos: 'portal:photos:all',
}

async function reorderViaRpc(scope: PracticeReorderScope, ids: string[]): Promise<number> {
  const { data, error } = await supabaseAdmin.rpc('portal_reorder_practice_content', {
    p_scope: scope,
    p_ordered_ids: ids,
  })
  if (error) throw error
  return Number(data ?? 0)
}

async function reorderSequentially(scope: PracticeReorderScope, ids: string[]): Promise<number> {
  const table = PRACTICE_REORDER_TABLE[scope]
  for (let index = 0; index < ids.length; index += 1) {
    const { error } = await supabaseAdmin
      .from(table)
      .update({ sort_order: index * 10 })
      .eq('id', ids[index])
    if (error) handlePortalContentError(error, table)
  }
  return ids.length
}

/**
 * Applies a dragged order from FeeTrack by rewriting sort_order for each row
 * in the given scope. The portal already renders practice content with
 * `sort_order` ascending, so the first entry in `orderedIds` appears first.
 * Uses a transactional RPC when available and falls back to sequential updates
 * on databases that have not yet applied the `052` migration.
 */
export async function reorderPracticeContent(scope: PracticeReorderScope, orderedIds: string[]) {
  ensureSupabaseForPortalContent()
  const ids = [...new Set(orderedIds.map((id) => String(id).trim()).filter((id) => id.length > 0))]
  if (!ids.length) throw new ApiError(400, 'Provide at least one practice content ID to reorder.')

  const updated = await reorderViaRpc(scope, ids).catch(async (error) => {
    logger.warn('portal_content.reorder_rpc_fallback', { scope, error })
    return reorderSequentially(scope, ids)
  })

  await invalidateCache(PRACTICE_REORDER_CACHE_KEY[scope])

  return { scope, orderedIds: ids, updated }
}

export async function getAllBranchTimetablesAdmin() {
  if (!isSupabaseReady()) return []

  try {
    const { data, error } = await supabaseAdmin
      .from('branch_timetables')
      .select('*')
      .order('is_active', { ascending: false })
      .order('effective_from', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) throw error
    return (data || []).map(mapTimetableRow)
  } catch (error) {
    logger.warn('portal_content.branch_timetables_load_failed', { error })
    return []
  }
}

export async function getActiveTimetableForBranchName(branchName?: string | null) {
  const branchSlug = await resolveBranchSlugForName(branchName)
  if (!branchSlug || !isSupabaseReady()) return null

  try {
    const { data, error } = await supabaseAdmin
      .from('branch_timetables')
      .select('*')
      .eq('branch_slug', branchSlug)
      .eq('is_active', true)
      .order('effective_from', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) throw error

    const today = new Date().toISOString().slice(0, 10)
    const rows = (data || []).map(mapTimetableRow)

    return (
      rows.find((row) => {
        const starts = !row.effectiveFrom || row.effectiveFrom <= today
        const ends = !row.effectiveTo || row.effectiveTo >= today
        return starts && ends
      }) ||
      rows[0] ||
      null
    )
  } catch (error) {
    logger.warn('portal_content.active_branch_timetable_load_failed', { branchSlug, error })
    return null
  }
}

export async function createBranchTimetable(payload: BranchTimetablePayload) {
  ensureSupabaseForPortalContent()
  const normalized = normaliseBranchTimetablePayload(payload)

  const { data, error } = await supabaseAdmin
    .from('branch_timetables')
    .insert({
      ...normalized,
      created_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (error) handlePortalContentError(error, 'branch_timetables')
  return mapTimetableRow(data)
}

export async function updateBranchTimetable(id: string, payload: BranchTimetablePayload) {
  ensureSupabaseForPortalContent()
  const normalized = normaliseBranchTimetablePayload({
    ...payload,
    id,
  })

  const { data, error } = await supabaseAdmin
    .from('branch_timetables')
    .update(normalized)
    .eq('id', id)
    .select('*')
    .single()

  if (error) handlePortalContentError(error, 'branch_timetables')
  return mapTimetableRow(data)
}

export async function deleteBranchTimetable(id: string) {
  ensureSupabaseForPortalContent()
  const { error } = await supabaseAdmin.from('branch_timetables').delete().eq('id', id)
  if (error) handlePortalContentError(error, 'branch_timetables')
}

export type HomePracticeAnalytics = {
  rangeDays: number
  overview: {
    watchedLessons: number
    uniqueAthletes: number
    completions: number
    completionRate: number
    averageProgress: number
  }
  videos: Array<{
    videoId: string
    title: string
    folderId: string
    contentFormat: 'landscape' | 'short'
    watches: number
    uniqueAthletes: number
    completions: number
    averageProgress: number
    lastWatchedAt: string
  }>
  athletes: Array<{
    skfId: string
    athleteName: string
    belt: string
    branch: string
    watchedLessons: number
    completedLessons: number
    averageProgress: number
    lastWatchedAt: string
  }>
  belts: Array<{ belt: string; watchedLessons: number; uniqueAthletes: number; completions: number; averageProgress: number }>
  recent: Array<{ skfId: string; athleteName: string; belt: string; videoTitle: string; progressPercent: number; completed: boolean; watchedAt: string }>
}

type VideoProgressAnalyticsRow = {
  skf_id?: string | null
  video_id?: string | null
  watched_percent?: number | null
  completed?: boolean | null
  last_watched?: string | null
}

type AthleteAnalyticsRow = {
  skf_id?: string | null
  first_name?: string | null
  last_name?: string | null
  current_belt?: string | null
  branch_name?: string | null
}

/** Staff-only aggregate for FeeTrack's Website Analytics screen. */
export async function getHomePracticeAnalytics(rangeDays = 90): Promise<HomePracticeAnalytics> {
  const safeRangeDays = Math.max(1, Math.min(365, Math.round(Number(rangeDays) || 90)))
  return cached<HomePracticeAnalytics>(`portal:analytics:practice:${safeRangeDays}`, 5 * 60, () =>
    computeHomePracticeAnalytics(safeRangeDays)
  )
}

async function computeHomePracticeAnalytics(safeRangeDays: number): Promise<HomePracticeAnalytics> {
  ensureSupabaseForPortalContent()
  const since = new Date(Date.now() - safeRangeDays * 24 * 60 * 60 * 1000).toISOString()
  const [{ data: progressRows, error: progressError }, videos] = await Promise.all([
    supabaseAdmin
      .from('video_progress')
      .select('skf_id, video_id, watched_percent, completed, last_watched')
      .gte('last_watched', since)
      .order('last_watched', { ascending: false })
      .limit(3000),
    getAllPortalVideosAdmin(),
  ])

  if (progressError) handlePortalContentError(progressError, 'video_progress')
  const progress = (progressRows || []) as VideoProgressAnalyticsRow[]
  const skfIds = [...new Set(progress.map((row) => String(row.skf_id || '').trim()).filter(Boolean))]
  const athleteRows: AthleteAnalyticsRow[] = []
  for (let offset = 0; offset < skfIds.length; offset += 200) {
    const { data, error } = await supabaseAdmin
      .from('athletes')
      .select('skf_id, first_name, last_name, current_belt, branch_name')
      .in('skf_id', skfIds.slice(offset, offset + 200))
    if (error) handlePortalContentError(error, 'athletes')
    athleteRows.push(...((data || []) as AthleteAnalyticsRow[]))
  }

  const videoById = new Map(videos.map((video) => [video.id, video]))
  const athleteBySkfId = new Map(athleteRows.map((athlete) => [String(athlete.skf_id || '').trim(), athlete]))
  const videoStats = new Map<string, { values: number[]; athletes: Set<string>; completions: number; lastWatchedAt: string }>()
  const athleteStats = new Map<string, { values: number[]; completions: number; lastWatchedAt: string }>()
  const beltStats = new Map<string, { values: number[]; athletes: Set<string>; completions: number }>()

  for (const entry of progress) {
    const skfId = String(entry.skf_id || '').trim()
    const videoId = String(entry.video_id || '').trim()
    if (!skfId || !videoId) continue
    const value = Math.max(0, Math.min(100, Number(entry.watched_percent || 0)))
    const completed = Boolean(entry.completed) || value >= 100
    const watchedAt = String(entry.last_watched || '')
    const athlete = athleteBySkfId.get(skfId)
    const belt = String(athlete?.current_belt || 'Unassigned').trim() || 'Unassigned'
    const videoSummary = videoStats.get(videoId) || { values: [], athletes: new Set<string>(), completions: 0, lastWatchedAt: watchedAt }
    videoSummary.values.push(value)
    videoSummary.athletes.add(skfId)
    if (completed) videoSummary.completions += 1
    if (watchedAt > videoSummary.lastWatchedAt) videoSummary.lastWatchedAt = watchedAt
    videoStats.set(videoId, videoSummary)

    const athleteSummary = athleteStats.get(skfId) || { values: [], completions: 0, lastWatchedAt: watchedAt }
    athleteSummary.values.push(value)
    if (completed) athleteSummary.completions += 1
    if (watchedAt > athleteSummary.lastWatchedAt) athleteSummary.lastWatchedAt = watchedAt
    athleteStats.set(skfId, athleteSummary)

    const beltSummary = beltStats.get(belt) || { values: [], athletes: new Set<string>(), completions: 0 }
    beltSummary.values.push(value)
    beltSummary.athletes.add(skfId)
    if (completed) beltSummary.completions += 1
    beltStats.set(belt, beltSummary)
  }

  const average = (values: number[]) => values.length ? Math.round(values.reduce((total, value) => total + value, 0) / values.length) : 0
  const nameFor = (skfId: string) => {
    const athlete = athleteBySkfId.get(skfId)
    const name = [athlete?.first_name, athlete?.last_name].filter(Boolean).join(' ').trim()
    return name || skfId
  }

  return {
    rangeDays: safeRangeDays,
    overview: {
      watchedLessons: progress.length,
      uniqueAthletes: athleteStats.size,
      completions: progress.filter((entry) => Boolean(entry.completed) || Number(entry.watched_percent || 0) >= 100).length,
      completionRate: progress.length ? Math.round((progress.filter((entry) => Boolean(entry.completed) || Number(entry.watched_percent || 0) >= 100).length / progress.length) * 100) : 0,
      averageProgress: average(progress.map((entry) => Math.max(0, Math.min(100, Number(entry.watched_percent || 0))))),
    },
    videos: [...videoStats.entries()].map(([videoId, summary]) => {
      const video = videoById.get(videoId)
      return { videoId, title: video?.title || 'Deleted lesson', folderId: video?.folderId || '', contentFormat: video?.contentFormat || 'landscape', watches: summary.values.length, uniqueAthletes: summary.athletes.size, completions: summary.completions, averageProgress: average(summary.values), lastWatchedAt: summary.lastWatchedAt }
    }).sort((left, right) => right.watches - left.watches || right.lastWatchedAt.localeCompare(left.lastWatchedAt)),
    athletes: [...athleteStats.entries()].map(([skfId, summary]) => {
      const athlete = athleteBySkfId.get(skfId)
      return { skfId, athleteName: nameFor(skfId), belt: String(athlete?.current_belt || 'Unassigned').trim() || 'Unassigned', branch: String(athlete?.branch_name || '').trim(), watchedLessons: summary.values.length, completedLessons: summary.completions, averageProgress: average(summary.values), lastWatchedAt: summary.lastWatchedAt }
    }).sort((left, right) => right.lastWatchedAt.localeCompare(left.lastWatchedAt)),
    belts: [...beltStats.entries()].map(([belt, summary]) => ({ belt, watchedLessons: summary.values.length, uniqueAthletes: summary.athletes.size, completions: summary.completions, averageProgress: average(summary.values) })).sort((left, right) => right.watchedLessons - left.watchedLessons),
    recent: progress.slice(0, 50).map((entry) => {
      const skfId = String(entry.skf_id || '').trim()
      const athlete = athleteBySkfId.get(skfId)
      const video = videoById.get(String(entry.video_id || '').trim())
      const progressPercent = Math.max(0, Math.min(100, Number(entry.watched_percent || 0)))
      return { skfId, athleteName: nameFor(skfId), belt: String(athlete?.current_belt || 'Unassigned').trim() || 'Unassigned', videoTitle: video?.title || 'Deleted lesson', progressPercent, completed: Boolean(entry.completed) || progressPercent >= 100, watchedAt: String(entry.last_watched || '') }
    }),
  }
}
