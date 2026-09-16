import { BELTS } from '@/data/constants/belts'

export type RecommendProgressDatum = {
  videoId: string
  progressPercent: number
  practicedCount?: number
}

export type RecommendVideoInput = {
  id: string
  title: string
  youtubeId: string
  createdAt: string
  folderId: string
  category: string
  beltLevels: string[]
  isFeatured: boolean
  folderTitle?: string
}

export type RecommendationReasonKey = 'series' | 'belt-match' | 'next-step' | 'new' | 'featured' | 'default'

export type RecommendationPick = {
  videoId: string
  reasonKey: RecommendationReasonKey
  reasonLabel: string
}

export type ScoredVideo = {
  id: string
  total: number
  beltFit: number
  recency: number
  continuity: number
  seriesTitle: string
  isNextStep: boolean
  isNew: boolean
  isFeatured: boolean
  practicedCount: number
}

/** A lesson at or above this watched share counts as "seen". */
export const WATCHED_THRESHOLD = 80
const HERO_TOP_N = 5
const NEW_WINDOW_MS = 30 * 24 * 60 * 60 * 1000
const DIRECTION_BONUS = 3

const BELT_RANK = new Map(BELTS.map((belt, index) => [belt.colour, index]))

function beltKey(value?: string | null) {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-belt$/, '')
  if (key.startsWith('black')) return 'black'
  return key
}

function beltRankOf(value?: string | null) {
  if (!value) return null
  return BELT_RANK.get(beltKey(value)) ?? null
}

function beltLabelOf(value?: string | null) {
  if (!value) return 'their'
  return BELTS.find((belt) => belt.colour === beltKey(value))?.label ?? value
}

function safeDateMs(value?: string | number | null) {
  const time = new Date(String(value || '')).getTime()
  return Number.isFinite(time) ? time : 0
}

/**
 * Deterministic hero-lesson ordering. Scores every lesson the athlete can
 * already see (zero extra queries) across:
 *   - belt fit: exact belt > same-or-higher belt (next challenge) > lower belt
 *   - recency: newer lessons lead, capped window for the "New this month" flag
 *   - series continuation: lessons siblings to ones already started
 *   - progress state: unwatched preferred; watched (>= 80%) lessons excluded
 *
 * The "newer" comparisons use the newest createdAt present in the given set,
 * never the wall clock, so two identical loads always rank the same way.
 */
export function rankPracticeVideos(
  videos: RecommendVideoInput[],
  progress: RecommendProgressDatum[],
  athleteBelt?: string | null
): ScoredVideo[] {
  const progressByVideoId = new Map(
    progress.map((entry) => [String(entry.videoId), Math.max(0, Math.min(100, Number(entry.progressPercent) || 0))])
  )
  const practicedCountByVideoId = new Map(
    progress.map((entry) => [String(entry.videoId), Math.max(0, Number(entry.practicedCount) || 0)])
  )
  const athleteRank = beltRankOf(athleteBelt)

  // Recency order as a stable ranking (0 = newest). Lexical ISO-8601 strings
  // sort chronologically, and identical timestamps break to id so the result
  // is deterministic regardless of the input order.
  const recencyIndexById = new Map(
    [...videos]
      .sort((a, b) => {
        const byDate = String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
        if (byDate !== 0) return byDate
        return String(a.id).localeCompare(String(b.id))
      })
      .map((video, index) => [video.id, index])
  )

  const newestCreatedMs = videos.reduce((max, video) => Math.max(max, safeDateMs(video.createdAt)), 0)

  // Continuation: count already-started siblings inside the same series.
  const startedSiblingsById = new Map<string, number>()
  const seriesTitleById = new Map<string, string>()
  const perFolder = new Map<string, string[]>()
  for (const video of videos) {
    const key = String(video.folderId || '')
    if (key) {
      const bucket = perFolder.get(key)
      if (bucket) bucket.push(video.id)
      else perFolder.set(key, [video.id])
      seriesTitleById.set(video.id, video.folderTitle || '')
    }
  }
  for (const ids of perFolder.values()) {
    const started = ids.filter((id) => (progressByVideoId.get(id) || 0) > 0).length
    for (const id of ids) startedSiblingsById.set(id, Math.min(started, 5))
  }

  const ranked: ScoredVideo[] = []

  for (const video of videos) {
    if (!video.youtubeId) continue
    const percent = progressByVideoId.get(video.id) || 0
    if (percent >= WATCHED_THRESHOLD) continue

    const videoRanks = video.beltLevels.map(beltRankOf).filter((rank): rank is number => rank !== null)
    let beltFit = 14
    let isNextStep = false
    if (athleteRank !== null && videoRanks.length > 0) {
      if (videoRanks.includes(athleteRank)) {
        beltFit = 40
        isNextStep = true
      } else {
        const closestRank = videoRanks.reduce((closest, rank) =>
          Math.abs(rank - athleteRank) < Math.abs(closest - athleteRank) ? rank : closest
        )
        beltFit = Math.max(0, 22 - Math.abs(closestRank - athleteRank))
        isNextStep = closestRank >= athleteRank
        if (isNextStep) beltFit += DIRECTION_BONUS
      }
    }

    const recency = Math.max(0, 25 - (recencyIndexById.get(video.id) ?? 25))
    const continuity = startedSiblingsById.get(video.id) || 0
    const state = percent === 0 ? 10 : 5
    const featured = video.isFeatured ? 5 : 0
    const total = beltFit + recency + continuity * 3 + state + featured

    ranked.push({
      id: video.id,
      total,
      beltFit,
      recency,
      continuity,
      seriesTitle: seriesTitleById.get(video.id) || '',
      isNextStep,
      isNew: newestCreatedMs > 0 && newestCreatedMs - safeDateMs(video.createdAt) <= NEW_WINDOW_MS,
      isFeatured: Boolean(video.isFeatured),
      practicedCount: practicedCountByVideoId.get(video.id) || 0,
    })
  }

  ranked.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total
    if (b.beltFit !== a.beltFit) return b.beltFit - a.beltFit
    if (b.recency !== a.recency) return b.recency - a.recency
    if (a.practicedCount !== b.practicedCount) return a.practicedCount - b.practicedCount
    return String(a.id).localeCompare(String(b.id))
  })

  return ranked
}

/** Picks the very best lesson and explains why. */
export function recommendPracticeVideo(
  videos: RecommendVideoInput[],
  progress: RecommendProgressDatum[],
  athleteBelt?: string | null
): RecommendationPick | null {
  const ranked = rankPracticeVideos(videos, progress, athleteBelt)
  if (!ranked.length) return null
  return pickForVideo(ranked[0], athleteBelt)
}

export function pickForVideo(scored: ScoredVideo, athleteBelt?: string | null): RecommendationPick {
  const beltLabel = beltLabelOf(athleteBelt)
  let reasonKey: RecommendationReasonKey = 'default'
  let reasonLabel = 'Recommended for you'
  if (scored.continuity > 0) {
    reasonKey = 'series'
    reasonLabel = scored.seriesTitle ? `Continues your ${scored.seriesTitle} series` : 'Continues its series'
  } else if (scored.beltFit >= 40) {
    reasonKey = 'belt-match'
    reasonLabel = `Matches your ${beltLabel}`
  } else if (scored.isNextStep) {
    reasonKey = 'next-step'
    reasonLabel = `Next step for your ${beltLabel}`
  } else if (scored.isNew) {
    reasonKey = 'new'
    reasonLabel = 'New this month'
  } else if (scored.isFeatured) {
    reasonKey = 'featured'
    reasonLabel = 'Featured practice'
  }

  return { videoId: scored.id, reasonKey, reasonLabel }
}

/**
 * Keeps the hero stable until it deserves to move on:
 *   - stored pick still in the top HERO_TOP_N AND still unwatched -> keep it,
 *   - otherwise -> advance to the best eligible pick that is not the old one.
 * Pure and deterministic given { ranked, previousVideoId }.
 */
export function nextHeroPick(ranked: ScoredVideo[], previousVideoId: string | null): string | null {
  if (!ranked.length) return null
  const top = ranked.slice(0, HERO_TOP_N)
  if (previousVideoId && top.some((video) => video.id === previousVideoId)) {
    return previousVideoId
  }
  const next = ranked.find((video) => video.id !== previousVideoId)
  return next ? next.id : top[0].id
}