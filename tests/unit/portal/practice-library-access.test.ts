import { describe, expect, it } from 'vitest'

import { practiceAudienceMatches } from '@/lib/server/repositories/portal-content-live'

describe('Home Practice audience rules', () => {
  const yellowMpMorning = { branchSlug: 'm-p-sports-club', batch: 'morning', belt: 'yellow' }

  // IMPROVISATION: audience filtering is currently bypassed (all content visible to all athletes).
  // Every combination should return true until the client re-enables restrictions.

  it('allows an unrestricted folder for every athlete', () => {
    expect(practiceAudienceMatches({ branchSlugs: [], batchNames: [], beltLevels: [] }, yellowMpMorning)).toBe(true)
  })

  it('allows all content when bypass is active', () => {
    const yellowMpFolder = {
      branchSlugs: ['m-p-sports-club'],
      batchNames: ['morning'],
      beltLevels: ['yellow'],
    }
    expect(practiceAudienceMatches(yellowMpFolder, yellowMpMorning)).toBe(true)
    expect(practiceAudienceMatches(yellowMpFolder, { ...yellowMpMorning, belt: 'orange' })).toBe(true)
    expect(practiceAudienceMatches(yellowMpFolder, { ...yellowMpMorning, branchSlug: 'herohalli' })).toBe(true)
  })

  it('allows all content regardless of folder or lesson rules when bypass is active', () => {
    const folderAllowsYellow = { branchSlugs: [], batchNames: [], beltLevels: ['yellow'] }
    const lessonAllowsOrange = { branchSlugs: [], batchNames: [], beltLevels: ['orange'] }
    expect(practiceAudienceMatches(folderAllowsYellow, yellowMpMorning)).toBe(true)
    expect(practiceAudienceMatches(lessonAllowsOrange, yellowMpMorning)).toBe(true)
  })

  it('allows all Kyu belt categories when bypass is active', () => {
    const greenTwo = { branchSlug: '', batch: '', belt: 'Green II Belt' }
    expect(practiceAudienceMatches({ branchSlugs: [], batchNames: [], beltLevels: ['green-ii'] }, greenTwo)).toBe(true)
    expect(practiceAudienceMatches({ branchSlugs: [], batchNames: [], beltLevels: ['green-i'] }, greenTwo)).toBe(true)
    expect(practiceAudienceMatches({ branchSlugs: [], batchNames: [], beltLevels: ['brown-iii'] }, { ...greenTwo, belt: 'Brown III' })).toBe(true)
  })

  it('matches human-readable batch names when bypass is active', () => {
    expect(practiceAudienceMatches(
      { branchSlugs: ['branch-a'], batchNames: ['evening'], beltLevels: ['black'] },
      { branchSlug: 'branch-a', batch: 'evening', belt: 'black' }
    )).toBe(true)
  })
})
