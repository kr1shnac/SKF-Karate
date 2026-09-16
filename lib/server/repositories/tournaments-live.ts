import { randomUUID } from 'node:crypto'
import { cache } from 'react'

import { ApiError } from '../api'
import { isSupabaseReady, supabaseAdmin } from '../supabase'
import { logger } from '@/src/server/lib/logger'
import { isPgrst303 } from '@/src/server/lib/pgrst-errors'
import {
  getAllTournamentsAdmin,
  type TournamentRecord,
  type TournamentWinner,
} from './tournaments'

const PGRST303_RETRY_MS = 1000

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export type TournamentDatabaseRow = {
  id?: string
  slug?: string
  name?: string
  short_name?: string | null
  level?: TournamentRecord['level']
  date?: string
  end_date?: string | null
  venue?: string | null
  city?: string | null
  state?: string | null
  description?: string | null
  cover_image_url?: string | null
  total_participants?: number | string | null
  skf_participants?: number | string | null
  medals?: TournamentRecord['medals'] | null
  affiliated_body?: string | null
  status?: TournamentRecord['status']
  is_published?: boolean | null
  is_featured?: boolean | null
  show_in_journey?: boolean | null
  created_at?: string | null
  updated_at?: string | null
  participants?: TournamentRecord['participants']
  winners?: TournamentWinner[]
  results?: TournamentRecord['results']
  results_applied_at?: string | null
}

type DatabaseWriteError = {
  code?: string
  message?: string
}

function cloneTournamentData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function sortByDateDesc<T extends { date: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )
}

function recalculateMedals(
  winners: TournamentWinner[] = []
): TournamentRecord['medals'] {
  return {
    gold: winners.filter((winner) => winner.medal === 'gold').length,
    silver: winners.filter((winner) => winner.medal === 'silver').length,
    bronze: winners.filter((winner) => winner.medal === 'bronze').length,
  }
}

function normaliseTournamentPayload(
  input: Partial<TournamentRecord> = {},
  existing: TournamentRecord | null = null
): TournamentRecord {
  const winners = Array.isArray(input.winners) ? input.winners : existing?.winners || []
  const participants = Array.isArray(input.participants)
    ? input.participants
    : existing?.participants || []
  const results = Array.isArray(input.results) ? input.results : existing?.results || []
  const now = new Date().toISOString()

  return {
    id: existing?.id || input.id || `t_${randomUUID()}`,
    slug: input.slug?.trim() || existing?.slug || '',
    name: input.name?.trim() || existing?.name || '',
    shortName: input.shortName?.trim() || existing?.shortName || '',
    level: input.level || existing?.level || 'district',
    date: input.date || existing?.date || '',
    endDate: input.endDate || existing?.endDate || '',
    venue: input.venue?.trim() || existing?.venue || '',
    city: input.city?.trim() || existing?.city || '',
    state: input.state?.trim() || existing?.state || 'Karnataka',
    description: input.description?.trim() || existing?.description || '',
    coverImageUrl: input.coverImageUrl || existing?.coverImageUrl || '',
    status: input.status || existing?.status || 'draft',
    totalParticipants: Number(input.totalParticipants ?? existing?.totalParticipants ?? 0),
    skfParticipants: Number(input.skfParticipants ?? existing?.skfParticipants ?? 0),
    medals: input.medals || recalculateMedals(winners),
    affiliatedBody: input.affiliatedBody || existing?.affiliatedBody || '',
    isPublished:
      typeof input.isPublished === 'boolean' ? input.isPublished : existing?.isPublished ?? false,
    isFeatured:
      typeof input.isFeatured === 'boolean' ? input.isFeatured : existing?.isFeatured ?? false,
    showInJourney:
      typeof input.showInJourney === 'boolean'
        ? input.showInJourney
        : existing?.showInJourney ?? false,
    resultsAppliedAt: input.resultsAppliedAt || existing?.resultsAppliedAt || '',
    createdAt: existing?.createdAt || input.createdAt || now,
    updatedAt: now,
    participants,
    results,
    winners,
  }
}

export function mapTournamentRowToRecord(row: TournamentDatabaseRow): TournamentRecord {
  return {
    id: row.id || '',
    slug: row.slug || '',
    name: row.name || '',
    shortName: row.short_name || '',
    level: row.level || 'district',
    date: row.date || '',
    endDate: row.end_date || '',
    venue: row.venue || '',
    city: row.city || '',
    state: row.state || 'Karnataka',
    description: row.description || '',
    coverImageUrl: row.cover_image_url || '',
    totalParticipants: Number(row.total_participants || 0),
    skfParticipants: Number(row.skf_participants || 0),
    medals:
      row.medals && typeof row.medals === 'object'
        ? row.medals
        : { gold: 0, silver: 0, bronze: 0 },
    affiliatedBody: row.affiliated_body || '',
    status: row.status || 'draft',
    isPublished: Boolean(row.is_published),
    isFeatured: Boolean(row.is_featured),
    showInJourney: Boolean(row.show_in_journey),
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || new Date().toISOString(),
    participants: Array.isArray(row.participants) ? row.participants : [],
    winners: Array.isArray(row.winners) ? row.winners : [],
    results: Array.isArray(row.results) ? row.results : [],
    resultsAppliedAt: row.results_applied_at || '',
  }
}

function mapTournamentRecordToRow(record: TournamentRecord): Record<string, unknown> {
  return {
    id: record.id,
    slug: record.slug,
    name: record.name,
    short_name: record.shortName,
    level: record.level,
    date: record.date || null,
    end_date: record.endDate || null,
    venue: record.venue || null,
    city: record.city || null,
    state: record.state || 'Karnataka',
    description: record.description || null,
    cover_image_url: record.coverImageUrl || null,
    total_participants: Number(record.totalParticipants || 0),
    skf_participants: Number(record.skfParticipants || 0),
    medals: record.medals || recalculateMedals(record.winners || []),
    affiliated_body: record.affiliatedBody || null,
    status: record.status || 'draft',
    is_published: Boolean(record.isPublished),
    is_featured: Boolean(record.isFeatured),
    show_in_journey: Boolean(record.showInJourney),
    results_applied_at: record.resultsAppliedAt || null,
    participants: Array.isArray(record.participants) ? record.participants : [],
    winners: Array.isArray(record.winners) ? record.winners : [],
    results: Array.isArray(record.results) ? record.results : [],
    created_at: record.createdAt || new Date().toISOString(),
    updated_at: record.updatedAt || new Date().toISOString(),
  }
}

async function readAllTournamentsFromDatabase(): Promise<TournamentRecord[]> {
  const { data, error } = await supabaseAdmin
    .from('tournaments')
    .select('*')
    .order('date', { ascending: false })

  if (error) {
    throw error
  }

  return (data || []).map((row) => mapTournamentRowToRecord(row))
}

const getTournamentDataset = cache(async function getTournamentDataset(): Promise<TournamentRecord[]> {
  if (!isSupabaseReady()) {
    return cloneTournamentData(getAllTournamentsAdmin())
  }

  try {
    return await readAllTournamentsFromDatabase()
  } catch (error) {
    if (isPgrst303(error)) {
      logger.warn('tournaments_live.pgrst303_retry', { error })
      await sleep(PGRST303_RETRY_MS)
      try {
        return await readAllTournamentsFromDatabase()
      } catch (retryError) {
        logger.warn('tournaments_live.local_fallback_retry_failed', { error: retryError })
      }
    } else {
      logger.warn('tournaments_live.local_fallback', { error })
    }
    return cloneTournamentData(getAllTournamentsAdmin())
  }
})

async function hasTournamentSlugLive(slug: string, excludeId: string | null = null) {
  const normalized = String(slug || '').trim().toLowerCase()
  const tournaments = await getTournamentDataset()

  return tournaments.some((tournament) => {
    return tournament.slug.toLowerCase() === normalized && tournament.id !== excludeId
  })
}

function handleTournamentWriteError(error: DatabaseWriteError): never {
  if (error?.code === 'PGRST205') {
    throw new ApiError(
      500,
      'Supabase schema is incomplete: missing "tournaments" table. Run database/schema.sql in the connected Supabase project.'
    )
  }

  if (error?.code === '23505') {
    throw new ApiError(409, 'A tournament with this slug already exists.')
  }

  throw new ApiError(500, error?.message || 'Unable to persist the tournament.')
}

export async function getAllTournamentsAdminLive() {
  return cloneTournamentData(sortByDateDesc(await getTournamentDataset()))
}

export async function getAllTournamentsLive() {
  const tournaments = await getTournamentDataset()
  return cloneTournamentData(
    sortByDateDesc(tournaments.filter((tournament) => tournament.isPublished))
  )
}

export async function getFeaturedTournamentsLive() {
  const tournaments = await getAllTournamentsLive()
  return cloneTournamentData(
    tournaments.filter((tournament) => tournament.isFeatured).slice(0, 3)
  )
}

export async function getTournamentBySlugLive(slug: string) {
  const tournaments = await getAllTournamentsLive()
  const tournament = tournaments.find((entry) => entry.slug === slug) || null
  return tournament ? cloneTournamentData(tournament) : null
}

export async function getTournamentByIdLive(id: string) {
  const tournaments = await getTournamentDataset()
  const tournament = tournaments.find((entry) => entry.id === id) || null
  return tournament ? cloneTournamentData(tournament) : null
}

export async function getAvailableYearsLive() {
  const tournaments = await getAllTournamentsLive()
  const years = [...new Set(tournaments.map((entry) => new Date(entry.date).getFullYear()))]
  return years.sort((a, b) => b - a)
}

export async function getTournamentStatsLive() {
  const tournaments = await getAllTournamentsLive()
  const totalGold = tournaments.reduce((sum, tournament) => sum + tournament.medals.gold, 0)
  const totalSilver = tournaments.reduce((sum, tournament) => sum + tournament.medals.silver, 0)
  const totalBronze = tournaments.reduce((sum, tournament) => sum + tournament.medals.bronze, 0)
  const nationalInternational = tournaments.filter(
    (tournament) =>
      tournament.level === 'national' || tournament.level === 'international'
  )
  const nationalChampions = nationalInternational.reduce(
    (sum, tournament) => sum + tournament.medals.gold,
    0
  )
  const years = await getAvailableYearsLive()
  const yearsActive = years.length > 0 ? years[0] - years[years.length - 1] + 1 : 0

  return {
    totalTournaments: tournaments.length,
    totalGold,
    totalSilver,
    totalBronze,
    totalMedals: totalGold + totalSilver + totalBronze,
    nationalChampions,
    yearsActive,
  }
}

export async function searchTournamentsLive(query: string) {
  const tournaments = await getAllTournamentsLive()
  const normalized = String(query || '').toLowerCase().trim()
  if (!normalized) return tournaments

  return cloneTournamentData(
    tournaments.filter(
      (tournament) =>
        tournament.name.toLowerCase().includes(normalized) ||
        tournament.shortName.toLowerCase().includes(normalized) ||
        tournament.venue.toLowerCase().includes(normalized) ||
        tournament.city.toLowerCase().includes(normalized) ||
        tournament.winners.some((winner) =>
          winner.athleteName.toLowerCase().includes(normalized)
        )
    )
  )
}

export async function createTournamentLive(input: Partial<TournamentRecord>) {
  if (!isSupabaseReady()) {
    throw new ApiError(503, 'Tournament database is not available.')
  }

  const tournament = normaliseTournamentPayload(input)

  if (await hasTournamentSlugLive(tournament.slug)) {
    throw new ApiError(409, 'A tournament with this slug already exists.')
  }

  const { data, error } = await supabaseAdmin
    .from('tournaments')
    .insert(mapTournamentRecordToRow(tournament))
    .select('*')
    .single()

  if (error) {
    handleTournamentWriteError(error)
  }

  return mapTournamentRowToRecord(data)
}

export async function updateTournamentLive(id: string, input: Partial<TournamentRecord>) {
  if (!isSupabaseReady()) {
    throw new ApiError(503, 'Tournament database is not available.')
  }

  const existing = await getTournamentByIdLive(id)
  if (!existing) return null

  const tournament = normaliseTournamentPayload(input, existing)

  if (await hasTournamentSlugLive(tournament.slug, id)) {
    throw new ApiError(409, 'A tournament with this slug already exists.')
  }

  const { data, error } = await supabaseAdmin
    .from('tournaments')
    .update(mapTournamentRecordToRow(tournament))
    .eq('id', id)
    .select('*')
    .single()

  if (error) {
    handleTournamentWriteError(error)
  }

  return mapTournamentRowToRecord(data)
}

export async function deleteTournamentLive(id: string) {
  if (!isSupabaseReady()) {
    throw new ApiError(503, 'Tournament database is not available.')
  }

  const { error } = await supabaseAdmin.from('tournaments').delete().eq('id', id)

  if (error) {
    throw new ApiError(500, error.message || 'Unable to delete the tournament.')
  }

  return true
}
