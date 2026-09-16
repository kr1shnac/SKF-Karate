-- Practice Video Recommendation: per-athlete "last shown" tracking.
--
-- The hero lesson is kept stable until the athlete reaches WATCHED (80%+);
-- once watched, the next library load advances to a fresh pick. This table
-- remembers the last shown video + reason and how many times it was served,
-- so subsequent visits can keep or advance the pick across sessions/devices.

CREATE TABLE IF NOT EXISTS athlete_recommendations (
  skf_id TEXT PRIMARY KEY,
  video_id TEXT NOT NULL,
  reason_key TEXT NOT NULL DEFAULT 'default',
  reason_label TEXT NOT NULL DEFAULT 'Recommended for you',
  visit_count INTEGER NOT NULL DEFAULT 0,
  last_shown_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE athlete_recommendations ENABLE ROW LEVEL SECURITY;

-- Only service_role can access (bypasses RLS)
CREATE POLICY "service_role_full_athlete_recommendations" ON athlete_recommendations
  FOR ALL USING (auth.role() = 'service_role');