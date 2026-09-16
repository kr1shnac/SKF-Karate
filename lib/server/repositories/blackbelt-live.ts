/**
 * blackbelt-live.ts — Repository for Black Belt Examination Program data.
 *
 * All reads go through supabaseAdmin (service_role).
 * This follows the same pattern as athletes-live.ts and events-live.ts.
 */

import { supabaseAdmin, isSupabaseReady } from '@/lib/server/supabase'
import { cached } from '@/src/server/lib/cache'
import { logger } from '@/src/server/lib/logger'
import { normaliseBlackBeltCandidateId } from '@/data/constants/blackbelt'

function dedupeCandidates(candidates: BBCandidate[]) {
  const bySkfId = new Map<string, BBCandidate>()

  for (const candidate of candidates) {
    const normalized = normaliseBlackBeltCandidateId(candidate.skf_id)

    const nextCandidate = { ...candidate, skf_id: normalized }
    const existing = bySkfId.get(normalized)
    if (!existing || Number(nextCandidate.sort_order || 0) < Number(existing.sort_order || 0)) {
      bySkfId.set(normalized, nextCandidate)
    }
  }

  return [...bySkfId.values()].sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0))
}

/* ═══════════════════ Types ═══════════════════ */

export interface BBProgram {
  id: string
  title: string
  slug: string
  tagline: string
  exam_date: string | null
  program_start: string | null
  program_end: string | null
  status: 'draft' | 'active' | 'completed' | 'archived'
  exam_components: ExamComponent[]
  wkf_documents: WKFDocument[]
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface ExamComponent {
  id: string
  name: string
  weight: number
  description: string
}

export interface WKFDocument {
  id: string
  title: string
  url: string
  description: string
}

export interface BBCandidate {
  id: string
  program_id: string
  skf_id: string
  display_name: string
  display_code: string | null
  photo_url: string | null
  weapon_group: 'bo_staff' | 'nunchaku'
  bunkai_group: 'group_a' | 'group_b'
  self_defense_day: 'tuesday' | 'friday' | 'saturday'

  first_aid_status: 'not_started' | 'in_progress' | 'completed'
  first_aid_cert_date: string | null

  marketing_status: 'in_progress' | 'enrolled'
  enrolled_student_name: string | null
  enrolled_student_date: string | null

  enrollment_fee_status: 'pending' | 'verifying' | 'paid'

  tournament_kata_status: 'not_won' | 'won'
  tournament_kata_event: string | null
  tournament_kata_date: string | null
  tournament_kumite_status: 'not_won' | 'won'
  tournament_kumite_event: string | null
  tournament_kumite_date: string | null

  fitness_baseline_done: boolean
  fitness_baseline_data: FitnessData
  fitness_retest_done: boolean
  fitness_retest_data: FitnessData
  fitness_months?: {
    month_1?: FitnessData
    month_2?: FitnessData
    month_3?: FitnessData
    month_4?: FitnessData
    month_5?: FitnessData
  }
  fitness_improved: boolean | null

  wkf_kumite_status: 'not_started' | 'reading' | 'quiz_passed'
  wkf_kata_status: 'not_started' | 'reading' | 'quiz_passed'
  wkf_referee_status: 'not_started' | 'in_progress' | 'reviewed'

  weapon_status: 'not_started' | 'in_progress' | 'exam_ready'
  bunkai_status: 'not_done' | 'internal_demo' | 'taught_to_kids'

  self_defense_months: Record<string, boolean>

  video_count: number
  video_target: number

  teaching_status: 'active' | 'ongoing' | 'flagged'
  teaching_hours: number
  mock_exam_done: boolean

  readiness: 'on_track' | 'attention_needed' | 'exam_ready'

  exam_score: number | null
  exam_result: 'pass' | 'conditional' | 'defer' | null
  exam_component_scores: Record<string, number>

  instructor_notes: string

  sort_order: number
  created_at: string
  updated_at: string
}

export interface FitnessData {
  pushups?: number
  pullups?: number
  situps?: number
  run_time?: string
  leg_split?: number
}

export interface BBProgressEntry {
  id: string
  candidate_id: string
  entry_type: string
  title: string
  description: string
  month_number: number | null
  entry_date: string
  metadata: Record<string, unknown>
  is_private: boolean
  created_at: string
}

/* ═══════════════════ Queries ═══════════════════ */

/**
 * Get the currently active BB program (only one should be active at a time).
 */
export async function getActiveBBProgram(): Promise<BBProgram | null> {
  const { data, error } = await supabaseAdmin
    .from('bb_programs')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    logger.error('blackbelt_live.active_program_failed', { error })
    return null
  }

  return data as BBProgram | null
}

/**
 * Get a program by ID regardless of status.
 */
export async function getBBProgramById(programId: string): Promise<BBProgram | null> {
  const { data, error } = await supabaseAdmin
    .from('bb_programs')
    .select('*')
    .eq('id', programId)
    .maybeSingle()

  if (error) {
    logger.error('blackbelt_live.program_by_id_failed', { programId, error })
    return null
  }

  return data as BBProgram | null
}

/**
 * Get all candidates for a program, ordered by sort_order.
 */
export async function getAllBBCandidates(programId: string): Promise<BBCandidate[]> {
  const { data, error } = await supabaseAdmin
    .from('bb_candidates')
    .select('*')
    .eq('program_id', programId)
    .order('sort_order', { ascending: true })

  if (error) {
    logger.error('blackbelt_live.candidates_load_failed', { programId, error })
    return []
  }

  return dedupeCandidates((data || []) as BBCandidate[])
}

/**
 * Get all candidates across every program.
 */
export async function getAllBBCandidatesAcrossPrograms(): Promise<BBCandidate[]> {
  const { data, error } = await supabaseAdmin
    .from('bb_candidates')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    logger.error('blackbelt_live.all_candidates_load_failed', { error })
    return []
  }

  return (data || []) as BBCandidate[]
}

/**
 * Get a specific candidate by their SKF ID within a program.
 */
export async function getBBCandidateBySkfId(
  programId: string,
  skfId: string
): Promise<BBCandidate | null> {
  const { data, error } = await supabaseAdmin
    .from('bb_candidates')
    .select('*')
    .eq('program_id', programId)
    .eq('skf_id', skfId)
    .maybeSingle()

  if (error) {
    logger.error('blackbelt_live.candidate_by_skf_id_failed', { programId, skfId, error })
    return null
  }

  return data as BBCandidate | null
}

/**
 * Get a specific candidate by their SKF ID across every program.
 * Portal access is tied to the candidate enrollment row, not the program status.
 */
export async function getBBCandidateBySkfIdAcrossPrograms(
  skfId?: string | null
): Promise<BBCandidate | null> {
  const raw = String(skfId || '').trim()
  if (!raw) return null

  const normalizedAthleteId = normaliseBlackBeltCandidateId(raw)

  const { data, error } = await supabaseAdmin
    .from('bb_candidates')
    .select('*')
    .ilike('skf_id', normalizedAthleteId)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    logger.error('blackbelt_live.candidate_by_skf_id_any_program_failed', {
      skfId: normalizedAthleteId,
      error,
    })
    return null
  }

  if (data?.[0]) return { ...(data[0] as BBCandidate), skf_id: normalizedAthleteId }

  // Fallback: normalize stored candidate IDs before comparison.
  const allCandidates = await getAllBBCandidatesAcrossPrograms()
  return (
    dedupeCandidates(allCandidates).find((candidate) => normaliseBlackBeltCandidateId(candidate.skf_id) === normalizedAthleteId) ||
    null
  )
}

/**
 * Get the program containing an assigned candidate, regardless of status.
 */
export async function getBBProgramForCandidate(skfId?: string | null): Promise<BBProgram | null> {
  const candidate = await getBBCandidateBySkfIdAcrossPrograms(skfId)
  if (!candidate?.program_id) return null
  return getBBProgramById(candidate.program_id)
}

/**
 * True when the athlete is assigned to any Black Belt program.
 * Used by both the portal navigation and the route guard so visibility matches access.
 * Redis-cached per athlete (2 min) so the candidate check is not repeated on
 * every client-side navigation; without Redis it degrades to a direct read.
 */
export async function isBBCandidate(skfId?: string | null): Promise<boolean> {
  if (!skfId) return false

  const lookup = () => getBBCandidateBySkfIdAcrossPrograms(skfId)

  if (isSupabaseReady()) {
    return cached(`portal:bb-candidate:${skfId}`, 120, async () =>
      Boolean(await lookup())
    )
  }

  return Boolean(await lookup())
}

export const isActiveBBCandidate = isBBCandidate

/**
 * Get progress entries for a candidate (public entries only).
 */
export async function getBBCandidateProgress(
  candidateId: string,
  includePrivate = false
): Promise<BBProgressEntry[]> {
  let query = supabaseAdmin
    .from('bb_progress_entries')
    .select('*')
    .eq('candidate_id', candidateId)
    .order('entry_date', { ascending: false })

  if (!includePrivate) {
    query = query.eq('is_private', false)
  }

  const { data, error } = await query

  if (error) {
    logger.error('blackbelt_live.candidate_progress_failed', { candidateId, error })
    return []
  }

  return (data || []) as BBProgressEntry[]
}

/**
 * Full portal data bundle: program + all candidates + their public progress.
 *
 * Strictly candidate-scoped: the caller must be an assigned candidate whose
 * enrollment row exists in `bb_candidates`. There is deliberately NO fallback
 * to the active program — a non-candidate must never be served program data.
 * This is the single query used by the portal page.
 */
export async function getBBProgramForPortal(skfId?: string | null) {
  const candidate = skfId ? await getBBCandidateBySkfIdAcrossPrograms(skfId) : null
  if (!candidate?.program_id) return null

  const program = await getBBProgramById(candidate.program_id)
  if (!program) return null

  const candidates = await getAllBBCandidates(program.id)
  const candidateIds = candidates.map((c) => c.id)

  // Single-query batch fetch for all candidate progress entries to eliminate N+1 roundtrips
  const { data: progressData } = candidateIds.length
    ? await supabaseAdmin
        .from('bb_progress_entries')
        .select('*')
        .in('candidate_id', candidateIds)
        .eq('is_private', false)
        .order('entry_date', { ascending: false })
    : { data: [] }

  const progressMap: Record<string, BBProgressEntry[]> = {}
  for (const c of candidates) {
    progressMap[c.id] = []
  }
  for (const entry of (progressData || [])) {
    if (progressMap[entry.candidate_id]) {
      progressMap[entry.candidate_id].push(entry as BBProgressEntry)
    }
  }

  return {
    program,
    candidates,
    progressMap,
  }
}

export async function updateBBCandidateAdmin(candidateId: string, updates: Partial<BBCandidate>): Promise<BBCandidate | null> {
  const { data, error } = await supabaseAdmin
    .from('bb_candidates')
    .update(updates)
    .eq('id', candidateId)
    .select('*')
    .maybeSingle()

  if (error) {
    logger.error('blackbelt_live.update_candidate_failed', { candidateId, error })
    return null
  }

  return data as BBCandidate | null
}
