-- Applies a dragged practice-content order (folders / videos / photos) in a
-- single transactional round-trip instead of N sequential client updates.
-- sort_order is rewritten as ascending multiples of 10 so the first entry in
-- the ordered list renders first in the athlete portal.
CREATE OR REPLACE FUNCTION public.portal_reorder_practice_content(
    p_scope text,
    p_ordered_ids text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_table text;
    v_position integer;
    v_updated integer := 0;
    v_id text;
BEGIN
    SELECT CASE
        WHEN p_scope = 'folders' THEN 'portal_practice_folders'
        WHEN p_scope = 'videos'  THEN 'portal_videos'
        WHEN p_scope = 'photos'  THEN 'portal_practice_photos'
        ELSE NULL
    END INTO v_table;

    IF v_table IS NULL THEN
        RAISE EXCEPTION 'Invalid practice reorder scope: %', p_scope
            USING ERRCODE = '22023';
    END IF;

    IF p_ordered_ids IS NULL OR cardinality(p_ordered_ids) = 0 THEN
        RETURN 0;
    END IF;

    v_position := 0;
    FOREACH v_id IN ARRAY p_ordered_ids
    LOOP
        IF v_id IS NOT NULL AND length(v_id) > 0 THEN
            EXECUTE format(
                'UPDATE %I SET sort_order = $2 WHERE id = $1',
                v_table
            ) USING v_id::uuid, v_position * 10;

            IF FOUND THEN
                v_updated := v_updated + 1;
            END IF;

            v_position := v_position + 1;
        END IF;
    END LOOP;

    RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.portal_reorder_practice_content(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_reorder_practice_content(text, text[]) TO service_role;