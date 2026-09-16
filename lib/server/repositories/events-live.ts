import { randomUUID } from 'node:crypto'
import { cache } from 'react'

import { ApiError } from '../api'
import { isSupabaseReady, supabaseAdmin } from '../supabase'
import { logger } from '@/src/server/lib/logger'
import { isPgrst303 } from '@/src/server/lib/pgrst-errors'
import { getAssignedPortalEvents } from '@/lib/utils/portal-events'
import {
  buildUnifiedTournamentEvent,
  getAllEventsAdmin,
} from './events'
import {
  createTournamentLive,
  deleteTournamentLive,
  getAllTournamentsAdminLive,
  getAllTournamentsLive,
  getTournamentByIdLive,
  getTournamentBySlugLive,
  mapTournamentRowToRecord,
  type TournamentDatabaseRow,
  updateTournamentLive,
} from './tournaments-live'
import type {
  TournamentParticipant,
  TournamentRecord,
  TournamentResultRecord,
  TournamentWinner,
} from './tournaments'

type EventParticipant = TournamentParticipant
type EventResult = TournamentResultRecord
type EventWinner = TournamentWinner

type EventDatabaseRow = {
  id?: string
  slug?: string
  name?: string
  short_name?: string | null
  type?: string | null
  status?: string | null
  level?: string | null
  date?: string | null
  end_date?: string | null
  venue?: string | null
  city?: string | null
  state?: string | null
  description?: string | null
  cover_image_url?: string | null
  affiliated_body?: string | null
  is_published?: boolean | null
  is_featured?: boolean | null
  is_results_published?: boolean | null
  show_in_journey?: boolean | null
  hosting_branch?: string | null
  participants?: unknown
  results?: unknown
  results_applied_at?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type LegacyEventRecord = EventRecord & {
  sourceKind?: string
}

type DatabaseWriteError = {
  code?: string
  message?: string
}

export type EventRecord = {
  id: string
  slug: string
  name: string
  shortName: string
  type: string
  status: string
  level?: string
  date: string
  endDate: string
  venue: string
  city: string
  state: string
  description: string
  coverImageUrl: string
  affiliatedBody: string
  isPublished: boolean
  isFeatured: boolean
  isResultsPublished: boolean
  showInJourney: boolean
  hostingBranch: string
  participants: EventParticipant[]
  results: EventResult[]
  resultsAppliedAt: string
  winners?: EventWinner[]
  createdAt: string
  updatedAt: string
}

function cloneEventData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const PGRST303_RETRY_MS = 1000

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function sortByDateDesc<T extends { date: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )
}

function normaliseEventPayload(
  input: Partial<EventRecord> = {},
  existing: EventRecord | null = null
): EventRecord {
  const now = new Date().toISOString()

  return {
    id: existing?.id || input.id || `evt_${randomUUID()}`,
    slug: input.slug?.trim() || existing?.slug || '',
    name: input.name?.trim() || existing?.name || '',
    shortName: input.shortName?.trim() || existing?.shortName || input.name?.trim() || '',
    type: input.type || existing?.type || 'seminar',
    status: input.status || existing?.status || 'draft',
    level: input.level || existing?.level || '',
    date: input.date || existing?.date || '',
    endDate: input.endDate || existing?.endDate || '',
    venue: input.venue?.trim() || existing?.venue || '',
    city: input.city?.trim() || existing?.city || '',
    state: input.state?.trim() || existing?.state || 'Karnataka',
    description: input.description?.trim() || existing?.description || '',
    coverImageUrl: input.coverImageUrl || existing?.coverImageUrl || '',
    affiliatedBody: input.affiliatedBody || existing?.affiliatedBody || '',
    isPublished:
      typeof input.isPublished === 'boolean'
        ? input.isPublished
        : existing?.isPublished ?? false,
    isFeatured:
      typeof input.isFeatured === 'boolean'
        ? input.isFeatured
        : existing?.isFeatured ?? false,
    isResultsPublished:
      typeof input.isResultsPublished === 'boolean'
        ? input.isResultsPublished
        : existing?.isResultsPublished ?? false,
    showInJourney:
      typeof input.showInJourney === 'boolean'
        ? input.showInJourney
        : existing?.showInJourney ?? false,
    hostingBranch: input.hostingBranch || existing?.hostingBranch || '',
    participants: Array.isArray(input.participants)
      ? input.participants
      : existing?.participants || [],
    results: Array.isArray(input.results) ? input.results : existing?.results || [],
    resultsAppliedAt: input.resultsAppliedAt || existing?.resultsAppliedAt || '',
    winners: Array.isArray(input.winners) ? input.winners : existing?.winners || [],
    createdAt: existing?.createdAt || input.createdAt || now,
    updatedAt: now,
  }
}

function buildUnifiedStoredEvent(event: EventRecord): EventRecord & { sourceKind: 'event' } {
  return {
    ...cloneEventData(event),
    sourceKind: 'event',
  }
}

function mapEventRowToRecord(row: EventDatabaseRow): EventRecord {
  return {
    id: row.id || '',
    slug: row.slug || '',
    name: row.name || '',
    shortName: row.short_name || '',
    type: row.type || 'seminar',
    status: row.status || 'draft',
    level: row.level || '',
    date: row.date || '',
    endDate: row.end_date || '',
    venue: row.venue || '',
    city: row.city || '',
    state: row.state || 'Karnataka',
    description: row.description || '',
    coverImageUrl: row.cover_image_url || '',
    affiliatedBody: row.affiliated_body || '',
    isPublished: Boolean(row.is_published),
    isFeatured: Boolean(row.is_featured),
    isResultsPublished: Boolean(row.is_results_published),
    showInJourney: Boolean(row.show_in_journey),
    hostingBranch: row.hosting_branch || '',
    participants: Array.isArray(row.participants) ? row.participants : [],
    results: Array.isArray(row.results) ? row.results : [],
    resultsAppliedAt: row.results_applied_at || '',
    winners: [],
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
  }
}

function mapEventRecordToRow(record: EventRecord): Record<string, unknown> {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    short_name: record.shortName,
    type: record.type,
    status: record.status || 'draft',
    level: record.level || null,
    date: record.date || null,
    end_date: record.endDate || null,
    venue: record.venue || null,
    city: record.city || null,
    state: record.state || 'Karnataka',
    description: record.description || null,
    cover_image_url: record.coverImageUrl || null,
    affiliated_body: record.affiliatedBody || null,
    is_published: Boolean(record.isPublished),
    is_featured: Boolean(record.isFeatured),
    is_results_published: Boolean(record.isResultsPublished),
    show_in_journey: Boolean(record.showInJourney),
    hosting_branch: record.hostingBranch || null,
    participants: Array.isArray(record.participants) ? record.participants : [],
    results: Array.isArray(record.results) ? record.results : [],
    results_applied_at: record.resultsAppliedAt || null,
    created_at: record.createdAt || new Date().toISOString(),
    updated_at: record.updatedAt || new Date().toISOString(),
  }
}

async function readAllStandaloneEventsFromDatabase(): Promise<EventRecord[]> {
  const { data, error } = await supabaseAdmin
    .from('events')
    .select('*')
    .order('date', { ascending: false })

  if (error) {
    throw error
  }

  return (data || []).map(mapEventRowToRecord)
}

const getStandaloneEventDataset = cache(async function getStandaloneEventDataset(): Promise<EventRecord[]> {
  if (!isSupabaseReady()) {
    return cloneEventData(
      (getAllEventsAdmin() as LegacyEventRecord[]).filter((event) => event.sourceKind !== 'tournament')
    ) as EventRecord[]
  }

  try {
    return await readAllStandaloneEventsFromDatabase()
  } catch (error) {
    if (isPgrst303(error)) {
      logger.warn('events_live.pgrst303_retry', { error })
      await sleep(PGRST303_RETRY_MS)
      try {
        return await readAllStandaloneEventsFromDatabase()
      } catch (retryError) {
        logger.warn('events_live.local_fallback_retry_failed', { error: retryError })
      }
    } else {
      logger.warn('events_live.local_fallback', { error })
    }
    return cloneEventData(
      (getAllEventsAdmin() as LegacyEventRecord[]).filter((event) => event.sourceKind !== 'tournament')
    ) as EventRecord[]
  }
})

async function hasStandaloneEventSlugLive(slug: string, excludeId: string | null = null) {
  const normalized = String(slug || '').trim().toLowerCase()
  const events = await getStandaloneEventDataset()

  return events.some((event) => event.slug.toLowerCase() === normalized && event.id !== excludeId)
}

function handleEventWriteError(error: DatabaseWriteError): never {
  if (error?.code === 'PGRST205') {
    throw new ApiError(
      500,
      'Supabase schema is incomplete: missing "events" table. Run database/schema.sql in the connected Supabase project.'
    )
  }

  if (error?.code === '23505') {
    throw new ApiError(409, 'An event with this slug already exists.')
  }

  throw new ApiError(500, error?.message || 'Unable to persist the event.')
}

async function getStandaloneEventsAdminLive() {
  return cloneEventData(sortByDateDesc(await getStandaloneEventDataset()))
}

async function getStandaloneEventsLive() {
  const events = await getStandaloneEventDataset()
  return cloneEventData(sortByDateDesc(events.filter((event) => event.isPublished)))
}

export async function getAllEventsAdminLive() {
  const [standalone, tournaments] = await Promise.all([
    getStandaloneEventsAdminLive(),
    getAllTournamentsAdminLive(),
  ])

  const seen = new Set<string>()
  return sortByDateDesc([
    ...standalone.map(buildUnifiedStoredEvent),
    ...tournaments.map(buildUnifiedTournamentEvent),
  ].filter((event) => {
    if (seen.has(event.id)) return false
    seen.add(event.id)
    return true
  }))
}

export async function getAllEventsLive() {
  const [standalone, tournaments] = await Promise.all([
    getStandaloneEventsLive(),
    getAllTournamentsLive(),
  ])

  const seen = new Set<string>()
  return sortByDateDesc([
    ...standalone.map(buildUnifiedStoredEvent),
    ...tournaments.map(buildUnifiedTournamentEvent),
  ].filter((event) => {
    if (seen.has(event.id)) return false
    seen.add(event.id)
    return true
  }))
}

const UPCOMING_EVENT_COLUMNS = [
  'id', 'slug', 'name', 'short_name', 'type', 'status', 'level', 'date', 'end_date',
  'venue', 'city', 'state', 'is_published', 'is_featured', 'show_in_journey',
  'hosting_branch', 'participants', 'created_at', 'updated_at',
].join(',')

const UPCOMING_TOURNAMENT_COLUMNS = [
  'id', 'slug', 'name', 'short_name', 'status', 'level', 'date', 'end_date',
  'venue', 'city', 'state', 'is_published', 'is_featured', 'show_in_journey',
  'participants', 'created_at', 'updated_at',
].join(',')

/**
 * Lightweight upcoming-events feed for the athlete dashboard. Only fetches the
 * published standalone events + tournaments dated today or later, minus the
 * heavy `results` / `winners` / `description` / `cover_image_url` columns that
 * the "next events" widget never reads. Falls back to the full
 * `getAllEventsLive()` source when the database is unavailable.
 */
export async function getUpcomingPortalEventsLive(skfId?: string | null) {
  if (isSupabaseReady()) {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const fromDate = todayStart.toISOString()

    const [eventsQuery, tournamentsQuery] = await Promise.all([
      supabaseAdmin
        .from('events')
        .select(UPCOMING_EVENT_COLUMNS)
        .eq('is_published', true)
        .gte('date', fromDate)
        .order('date', { ascending: true }),
      supabaseAdmin
        .from('tournaments')
        .select(UPCOMING_TOURNAMENT_COLUMNS)
        .eq('is_published', true)
        .gte('date', fromDate)
        .order('date', { ascending: true }),
    ])

    if (eventsQuery.error) throw eventsQuery.error
    if (tournamentsQuery.error) throw tournamentsQuery.error

    const seen = new Set<string>()
    const merged = [
      ...(((eventsQuery.data || []) as unknown) as EventDatabaseRow[]).map((row) => buildUnifiedStoredEvent(mapEventRowToRecord(row))),
      ...(((tournamentsQuery.data || []) as unknown) as TournamentDatabaseRow[]).map((row) => buildUnifiedTournamentEvent(mapTournamentRowToRecord(row))),
    ].filter((event) => {
      if (seen.has(event.id)) return false
      seen.add(event.id)
      return true
    })

    return skfId ? getAssignedPortalEvents(merged, skfId) : merged
  }

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const allEvents = await getAllEventsLive()
  const upcoming = allEvents.filter(
    (event) => new Date(event.date || '').getTime() >= todayStart.getTime()
  )
  return skfId ? getAssignedPortalEvents(upcoming, skfId) : upcoming
}

export async function getEventByIdAdminLive(id: string) {
  const tournament = await getTournamentByIdLive(id)
  if (tournament) {
    return buildUnifiedTournamentEvent(tournament)
  }

  const events = await getStandaloneEventDataset()
  const event = events.find((entry) => entry.id === id) || null
  return event ? buildUnifiedStoredEvent(event) : null
}

export async function getEventBySlugLive(slug: string) {
  const tournament = await getTournamentBySlugLive(slug)
  if (tournament) {
    return buildUnifiedTournamentEvent(tournament)
  }

  const events = await getStandaloneEventsLive()
  const event = events.find((entry) => entry.slug === slug) || null
  return event ? buildUnifiedStoredEvent(event) : null
}

async function createStandaloneEventLive(input: Partial<EventRecord>) {
  if (!isSupabaseReady()) {
    throw new ApiError(503, 'Event database is not available.')
  }

  const event = normaliseEventPayload(input)

  if (await hasStandaloneEventSlugLive(event.slug)) {
    throw new ApiError(409, 'An event with this slug already exists.')
  }

  if (await getTournamentBySlugLive(event.slug)) {
    throw new ApiError(409, 'A tournament with this slug already exists.')
  }

  const { data, error } = await supabaseAdmin
    .from('events')
    .insert(mapEventRecordToRow(event))
    .select('*')
    .single()

  if (error) {
    handleEventWriteError(error)
  }

  return buildUnifiedStoredEvent(mapEventRowToRecord(data))
}

async function updateStandaloneEventLive(id: string, input: Partial<EventRecord>) {
  if (!isSupabaseReady()) {
    throw new ApiError(503, 'Event database is not available.')
  }

  const existingEvents = await getStandaloneEventDataset()
  const existing = existingEvents.find((entry) => entry.id === id) || null
  if (!existing) return null

  const event = normaliseEventPayload(input, existing)

  if (await hasStandaloneEventSlugLive(event.slug, id)) {
    throw new ApiError(409, 'An event with this slug already exists.')
  }

  const matchingTournament = await getTournamentBySlugLive(event.slug)
  if (matchingTournament && matchingTournament.id !== id) {
    throw new ApiError(409, 'A tournament with this slug already exists.')
  }

  const { data, error } = await supabaseAdmin
    .from('events')
    .update(mapEventRecordToRow(event))
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    handleEventWriteError(error)
  }

  return buildUnifiedStoredEvent(mapEventRowToRecord(data))
}

async function deleteStandaloneEventLive(id: string) {
  if (!isSupabaseReady()) {
    throw new ApiError(503, 'Event database is not available.')
  }

  const { error } = await supabaseAdmin.from('events').delete().eq('id', id)
  if (error) {
    throw new ApiError(500, error.message || 'Unable to delete the event.')
  }

  return true
}

export async function createEventRecordLive(input: Partial<EventRecord> | Partial<TournamentRecord>) {
  if ('type' in input && input.type === 'tournament') {
    return buildUnifiedTournamentEvent(await createTournamentLive(input as Partial<TournamentRecord>))
  }

  return createStandaloneEventLive(input as Partial<EventRecord>)
}

export async function updateEventRecordLive(id: string, input: Partial<EventRecord> | Partial<TournamentRecord>) {
  const tournament = await getTournamentByIdLive(id)
  if (tournament) {
    const updated = await updateTournamentLive(id, input as Partial<TournamentRecord>)
    return updated ? buildUnifiedTournamentEvent(updated) : null
  }

  return updateStandaloneEventLive(id, input as Partial<EventRecord>)
}

export async function deleteEventRecordLive(id: string) {
  const tournament = await getTournamentByIdLive(id)
  if (tournament) {
    return deleteTournamentLive(id)
  }

  return deleteStandaloneEventLive(id)
}
