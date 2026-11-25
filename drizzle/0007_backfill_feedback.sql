CREATE TABLE "backfill_progress" (
	"job" text PRIMARY KEY NOT NULL,
	"cursor" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "backfill_progress_cursor_object" CHECK ("backfill_progress"."cursor" IS NULL OR jsonb_typeof("backfill_progress"."cursor") = 'object')
);
--> statement-breakpoint
CREATE TABLE "site_feedback" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "site_feedback_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"path" text NOT NULL,
	"filters" text,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_feedback_kind" CHECK ("site_feedback"."kind" IN ('missing', 'alerts_interest')),
	CONSTRAINT "site_feedback_path" CHECK (char_length("site_feedback"."path") BETWEEN 1 AND 200 AND left("site_feedback"."path", 1) = '/'),
	CONSTRAINT "site_feedback_filters_length" CHECK (char_length("site_feedback"."filters") BETWEEN 1 AND 500),
	CONSTRAINT "site_feedback_message_length" CHECK (char_length("site_feedback"."message") BETWEEN 1 AND 1000),
	CONSTRAINT "site_feedback_message_by_kind" CHECK (("site_feedback"."kind" = 'missing') = ("site_feedback"."message" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX "site_feedback_created_at_idx" ON "site_feedback" USING btree ("created_at");--> statement-breakpoint
-- Counts site feedback for the site's throttle without letting the web role
-- read a row (D75). It runs as its owner, with a fixed search_path, takes only
-- a time and returns only a count.
CREATE FUNCTION "public"."site_feedback_count_since"("since" timestamp with time zone)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT count(*)::integer FROM public.site_feedback WHERE created_at >= since
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "public"."site_feedback_count_since"(timestamp with time zone) FROM PUBLIC;--> statement-breakpoint
-- The same privileges as scripts/sql/roles.sql, granted here as well so they
-- never depend on default privileges. The web role reads backfill_progress like
-- every other table, but may only insert into site_feedback and count it: the
-- SELECT that default privileges gave it on create is revoked. It gets no
-- rights on the id sequence, since an identity column needs none to insert.
-- Roles exist only in deployed databases, so this is skipped where they don't.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'signalfeed_ingest') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON backfill_progress, site_feedback TO signalfeed_ingest;
    GRANT USAGE, SELECT ON SEQUENCE site_feedback_id_seq TO signalfeed_ingest;
    GRANT EXECUTE ON FUNCTION site_feedback_count_since(timestamp with time zone) TO signalfeed_ingest;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'signalfeed_web') THEN
    GRANT SELECT ON backfill_progress TO signalfeed_web;
    REVOKE ALL ON site_feedback FROM signalfeed_web;
    REVOKE ALL ON SEQUENCE site_feedback_id_seq FROM signalfeed_web;
    GRANT INSERT ON site_feedback TO signalfeed_web;
    GRANT EXECUTE ON FUNCTION site_feedback_count_since(timestamp with time zone) TO signalfeed_web;
  END IF;
END
$$;
