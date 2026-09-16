import { isSupabaseReady, supabaseAdmin } from '@/lib/server/supabase'
import { logger } from '@/src/server/lib/logger'

import {
  nextHeroPick,
  pickForVideo,
  rankPracticeVideos,
  type RecommendProgressDatum,
  type RecommendVideoInput,
  type RecommendationPick,
} from './recommend-practice-video'

export type RecommendationDecision = {
  pick: RecommendationPick | null
  visitCount: number
}

/**
 * Serves the hero lesson with persistent per-athlete memory. On every library
 * load it re-ranks the visible lessons and:
 *   - keeps the stored pick if it is still in the top 5 and still unwatched,
 *   - otherwise advances to the best eligible pick that is not the old one.
 * The chosen video + reason are stored so the next visit can continue exactly
 * where this one left off, across sessions and devices.
 */
export class PortalRecommendationService {
  static async decideAndStore(input: {
    skfId: string
    videos: RecommendVideoInput[]
    progress: RecommendProgressDatum[]
    athleteBelt?: string | null
  }): Promise<RecommendationDecision> {
    const ranked = rankPracticeVideos(input.videos, input.progress, input.athleteBelt)

    let previousVideoId: string | null = null
    let visitCount = 1

    if (isSupabaseReady()) {
      try {
        const { data } = await supabaseAdmin
          .from('athlete_recommendations')
          .select('video_id, visit_count')
          .eq('skf_id', input.skfId)
          .maybeSingle()
        previousVideoId = data?.video_id || null
        visitCount = (Number(data?.visit_count) || 0) + 1
      } catch (error) {
        logger.warn('portal_recommendation.read_failed', { skfId: input.skfId, error })
      }
    }

    const chosenId = nextHeroPick(ranked, previousVideoId)
    const chosen = chosenId ? ranked.find((video) => video.id === chosenId) : undefined
    const pick = chosen ? pickForVideo(chosen, input.athleteBelt) : null

    if (isSupabaseReady()) {
      try {
        await supabaseAdmin.from('athlete_recommendations').upsert(
          {
            skf_id: input.skfId,
            video_id: pick?.videoId || '',
            reason_key: pick?.reasonKey || 'default',
            reason_label: pick?.reasonLabel || 'Recommended for you',
            visit_count: visitCount,
            last_shown_at: new Date().toISOString(),
          },
          { onConflict: 'skf_id' }
        )
      } catch (error) {
        logger.warn('portal_recommendation.save_failed', { skfId: input.skfId, error })
      }
    }

    return { pick, visitCount }
  }
}