import type { EntitySchema } from './types'

/**
 * Schema: video_progress
 * Source: SUPABASE_SCHEMA.sql (table 6)
 * Purpose: Tracks per-student video watch progress
 */
export const videoProgressSchema: EntitySchema = {
  entity: 'VideoProgress',
  tableName: 'video_progress',
  primaryKey: 'id',
  storage: 'supabase',
  rls: true,
  fields: {
    id:              { type: 'uuid',    supabaseType: 'UUID',        required: true,  default: 'gen_random_uuid()' },
    skf_id:          { type: 'string',  supabaseType: 'TEXT',        required: true },
    video_id:        { type: 'string',  supabaseType: 'TEXT',        required: true },
    watched_percent: { type: 'number',  supabaseType: 'INTEGER',     required: false, default: 0, description: 'CHECK (watched_percent BETWEEN 0 AND 100)' },
    completed:       { type: 'boolean', supabaseType: 'BOOLEAN',     required: false, default: false },
    last_watched:    { type: 'date',    supabaseType: 'TIMESTAMPTZ', required: false, default: 'NOW()' },
    watched_seconds: { type: 'number',  supabaseType: 'INTEGER',     required: false, default: 0, description: 'Exact resume position on the lesson timeline (drill-aware resume)' },
    practiced_count: { type: 'number',  supabaseType: 'INTEGER',     required: false, default: 0, description: 'Times the athlete tapped Practiced; only explicit taps count as drilling' },
    last_practiced_at: { type: 'date',  supabaseType: 'TIMESTAMPTZ', required: false, description: 'When the last Practiced tap happened' },
    updated_at:      { type: 'date',    supabaseType: 'TIMESTAMPTZ', required: false, default: 'NOW()', description: 'Maintained by the updated_at trigger (migration 050)' },
  },
  indexes: ['UNIQUE(skf_id, video_id)'],
  notes: 'Used by /api/portal/videos/progress. Videos live in the Supabase portal_videos table.',
}
