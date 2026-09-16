import { describe, expect, it } from 'vitest'

import {
  nextHeroPick,
  rankPracticeVideos,
  recommendPracticeVideo,
  WATCHED_THRESHOLD,
  type RecommendVideoInput,
} from '@/src/server/services/recommend-practice-video'

function video(overrides: Partial<RecommendVideoInput> = {}): RecommendVideoInput {
  return {
    id: 'v-' + Math.random().toString(36).slice(2, 8),
    title: 'Lesson',
    youtubeId: 'youtu_be_000',
    createdAt: '2026-01-01T00:00:00.000Z',
    folderId: '',
    category: 'kata',
    beltLevels: [],
    isFeatured: false,
    ...overrides,
  }
}

function fixedVideo(id: string, overrides: Partial<RecommendVideoInput> = {}): RecommendVideoInput {
  return video({ id, ...overrides })
}

describe('rankPracticeVideos', () => {
  it('returns an empty ranking when nothing eligible exists', () => {
    expect(rankPracticeVideos([], [])).toEqual([])
    expect(rankPracticeVideos([video({ youtubeId: '' })], [])).toEqual([])
  })

  it('prefers an exact belt match over unrestricted content', () => {
    const exact = video({ beltLevels: ['yellow'] })
    const general = video({ beltLevels: [] })
    const ranked = rankPracticeVideos([general, exact], [], 'yellow')
    expect(ranked[0].id).toBe(exact.id)
  })

  it('favours a lesson at or above the belt (next challenge) over a lower one', () => {
    const up = video({ beltLevels: ['orange'] })
    const down = video({ beltLevels: ['white'] })
    const ranked = rankPracticeVideos([down, up], [], 'yellow')
    expect(ranked[0].id).toBe(up.id)
  })

  it('excludes lessons at or above the watched threshold', () => {
    const watched = video({ createdAt: '2026-02-01T00:00:00.000Z' })
    const fresh = video({ createdAt: '2026-01-01T00:00:00.000Z' })
    const ranked = rankPracticeVideos(
      [watched, fresh],
      [{ videoId: watched.id, progressPercent: WATCHED_THRESHOLD }],
      '*'
    )
    expect(ranked.some((entry) => entry.id === watched.id)).toBe(false)
    expect(ranked[0].id).toBe(fresh.id)
  })

  it('keeps a partially-watched lesson eligible and prefers the unwatched twin', () => {
    const started = video({ createdAt: '2026-02-01T00:00:00.000Z' })
    const fresh = video({ createdAt: '2026-01-01T00:00:00.000Z' })
    const ranked = rankPracticeVideos(
      [started, fresh],
      [{ videoId: started.id, progressPercent: 45 }],
      '*'
    )
    expect(ranked.some((entry) => entry.id === started.id)).toBe(true)
    expect(ranked[0].id).toBe(fresh.id)
  })

  it('ranks by recency deterministically when other signals tie', () => {
    const older = video({ createdAt: '2026-01-01T00:00:00.000Z' })
    const newer = video({ createdAt: '2026-03-01T00:00:00.000Z' })
    const middle = video({ createdAt: '2026-02-01T00:00:00.000Z' })
    const first = rankPracticeVideos([older, middle, newer], [], 'black')
    const second = rankPracticeVideos([newer, middle, older], [], 'black')
    expect(first.map((entry) => entry.id)).toEqual(second.map((entry) => entry.id))
    expect(first[0].id).toBe(newer.id)
  })

  it('surfaces the least-practiced lesson first when other signals tie', () => {
    const drilled = fixedVideo('v-drilled', { createdAt: '2026-02-01T00:00:00.000Z' })
    const untouched = fixedVideo('v-fresh', { createdAt: '2026-02-01T00:00:00.000Z' })
    const ranked = rankPracticeVideos(
      [drilled, untouched],
      [{ videoId: drilled.id, progressPercent: 30, practicedCount: 4 }],
      '*'
    )
    expect(ranked.map((entry) => entry.id)).toEqual(['v-fresh', 'v-drilled'])
    expect(ranked[1].practicedCount).toBe(4)
  })

  it('favours the next lesson in a series the athlete already started', () => {
    const series = [video({ folderId: 'series-a' }), video({ folderId: 'series-a' }), video({ folderId: 'series-a' })]
    const lone = video({ createdAt: '2099-01-01T00:00:00.000Z' })
    const ranked = rankPracticeVideos(
      [lone, ...series],
      series.slice(0, 2).map((entry) => ({ videoId: entry.id, progressPercent: 5 })),
      '*'
    )
    expect(ranked[0].id).toBe(series[2].id)
  })

  it('breaks complete ties by video id for total determinism', () => {
    const a = fixedVideo('v-aaa')
    const b = fixedVideo('v-bbb')
    expect(rankPracticeVideos([b, a], [], '*')[0].id).toBe(a.id)
  })
})

describe('recommendPracticeVideo reasons', () => {
  it('explains an exact belt match', () => {
    const pick = recommendPracticeVideo([video({ beltLevels: ['yellow'] })], [], 'Yellow Belt')
    expect(pick).toEqual({ videoId: expect.any(String), reasonKey: 'belt-match', reasonLabel: 'Matches your Yellow Belt' })
  })

  it('explains a series continuation', () => {
    const series = [video({ folderId: 'series-a', folderTitle: 'Kata Basics' }), video({ folderId: 'series-a', folderTitle: 'Kata Basics' })]
    const pick = recommendPracticeVideo(
      [series[0], series[1]],
      [{ videoId: series[0].id, progressPercent: 5 }],
      '*'
    )
    expect(pick).toEqual({ videoId: series[1].id, reasonKey: 'series', reasonLabel: 'Continues your Kata Basics series' })
  })

  it('explains a next-step belt pick', () => {
    const pick = recommendPracticeVideo([video({ beltLevels: ['orange'] })], [], 'yellow')
    expect(pick?.reasonKey).toBe('next-step')
    expect(pick?.reasonLabel).toContain('Next step for your Yellow Belt')
  })

  it('explains a brand new lesson', () => {
    const fresh = video({ createdAt: '2026-03-01T00:00:00.000Z' })
    const old = video({ createdAt: '2026-01-15T00:00:00.000Z' })
    const pick = recommendPracticeVideo([fresh, old], [], '*')
    expect(pick?.reasonKey).toBe('new')
  })
})

describe('nextHeroPick', () => {
  const ranked = [
    fixedVideo('v-one', { createdAt: '2026-03-01T00:00:00.000Z' }),
    fixedVideo('v-two', { createdAt: '2026-02-01T00:00:00.000Z' }),
    fixedVideo('v-three', { createdAt: '2026-01-01T00:00:00.000Z' }),
  ].map((entry) => rankPracticeVideos([entry], [], '*')[0])
  const flat = ranked.flatMap((entry) => (entry ? [entry] : []))

  it('keeps the stored pick while it is still top and unwatched', () => {
    expect(nextHeroPick(flat, 'v-one')).toBe('v-one')
  })

  it('keeps the stored pick while it remains in the top window', () => {
    expect(nextHeroPick(flat, 'v-two')).toBe('v-two')
  })

  it('advances to the best eligible pick when the stored one dropped out', () => {
    expect(nextHeroPick(flat, 'v-gone')).toBe('v-one')
  })

  it('returns null when nothing is eligible', () => {
    expect(nextHeroPick([], 'v-one')).toBeNull()
  })
})