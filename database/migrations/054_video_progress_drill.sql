-- Practice drills + exact-position resume for Home Practice videos.
--
-- Practicing karate rarely means "finish one video": kids re-watch segments,
-- drill a move repeatedly, and stop mid-lesson. This migration adds:
--   - watched_seconds : exact resume position on the lesson timeline
--   - practiced_count : how many times "Practiced ✓" was tapped (deliberate
--     drilling — deliberately NOT auto-granted by merely watching)
--   - last_practiced_at: when the last drill tap happened
-- plus an atomic portal_bump_practice() used by the "Practiced ✓" button so a
-- tap can never double-count or race with another tap.

ALTER TABLE video_progress ADD COLUMN watched_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE video_progress ADD COLUMN practiced_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE video_progress ADD COLUMN last_practiced_at TIMESTAMPTZ;

-- Migration 050 attached an updated_at BEFORE UPDATE trigger to video_progress,
-- but the table was created (pre-migration) without an updated_at column — so
-- every write that hits the conflict/update branch raised
--   42703: record "new" has no field "updated_at"
-- and progress saves silently failed in production. Heal it here: add the
-- column (backfilled from last_watched) so the existing trigger works again.
ALTER TABLE video_progress ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
UPDATE video_progress SET updated_at = COALESCE(last_watched, updated_at);

CREATE OR REPLACE FUNCTION public.portal_bump_practice(
    p_skf_id text,
    p_video_id text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_count integer;
BEGIN
    INSERT INTO public.video_progress (skf_id, video_id, watched_percent, watched_seconds, practiced_count, last_watched, last_practiced_at)
    VALUES (p_skf_id, p_video_id, 0, 0, 1, NOW(), NOW())
    ON CONFLICT (skf_id, video_id)
    DO UPDATE SET
        practiced_count = video_progress.practiced_count + 1,
        last_practiced_at = NOW(),
        last_watched = NOW()
    RETURNING practiced_count INTO v_count;

    RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_bump_practice(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_bump_practice(text, text) TO service_role;