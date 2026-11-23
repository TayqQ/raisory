CREATE TYPE "public"."website_rule" AS ENUM('X1', 'X2', 'X3', 'W1', 'W2', 'W3', 'C1', 'C2', 'none', 'manual');--> statement-breakpoint
CREATE TYPE "public"."website_source" AS ENUM('article', 'ukri', 'name', 'guess');--> statement-breakpoint
ALTER TYPE "public"."registry_link_method" ADD VALUE 'website_number';--> statement-breakpoint
CREATE TABLE "company_logos" (
	"company_id" integer PRIMARY KEY NOT NULL,
	"bytes" "bytea",
	"mime" text,
	"width" integer,
	"height" integer,
	"sha256" text,
	"source_url" text,
	"fetched_at" timestamp with time zone,
	"blocked" boolean DEFAULT false NOT NULL,
	CONSTRAINT "company_logos_image_complete" CHECK ("company_logos"."blocked" OR ("company_logos"."bytes" IS NOT NULL AND "company_logos"."mime" IS NOT NULL AND "company_logos"."width" IS NOT NULL AND "company_logos"."height" IS NOT NULL AND "company_logos"."sha256" IS NOT NULL AND "company_logos"."source_url" IS NOT NULL AND "company_logos"."fetched_at" IS NOT NULL)),
	CONSTRAINT "company_logos_bytes_max" CHECK (octet_length("company_logos"."bytes") <= 65536),
	CONSTRAINT "company_logos_raster_mime" CHECK ("company_logos"."mime" LIKE 'image/%' AND "company_logos"."mime" <> 'image/svg+xml'),
	CONSTRAINT "company_logos_dimensions_positive" CHECK ("company_logos"."width" > 0 AND "company_logos"."height" > 0),
	CONSTRAINT "company_logos_sha256_hex" CHECK ("company_logos"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "company_websites" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "company_websites_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"domain" text NOT NULL,
	"status" "registry_link_status" NOT NULL,
	"rule" "website_rule" NOT NULL,
	"source" "website_source" NOT NULL,
	"evidence" text NOT NULL,
	"company_number_seen" text,
	"icon_candidates" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"decided_by" "link_decided_by" NOT NULL,
	"fingerprint" text NOT NULL,
	CONSTRAINT "company_websites_company_domain_unique" UNIQUE("company_id","domain"),
	CONSTRAINT "company_websites_domain_lower" CHECK ("company_websites"."domain" = lower("company_websites"."domain")),
	CONSTRAINT "company_websites_evidence_length" CHECK (char_length("company_websites"."evidence") <= 300),
	CONSTRAINT "company_websites_icon_candidates_max" CHECK (jsonb_typeof("company_websites"."icon_candidates") = 'array' AND jsonb_array_length("company_websites"."icon_candidates") <= 10)
);
--> statement-breakpoint
ALTER TABLE "grant_participants" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "company_logos" ADD CONSTRAINT "company_logos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_websites" ADD CONSTRAINT "company_websites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_websites_one_linked_per_domain_idx" ON "company_websites" USING btree ("domain") WHERE "company_websites"."status" = 'linked';--> statement-breakpoint
CREATE UNIQUE INDEX "company_websites_one_linked_per_company_idx" ON "company_websites" USING btree ("company_id") WHERE "company_websites"."status" = 'linked';--> statement-breakpoint
ALTER TABLE "grant_participants" ADD CONSTRAINT "grant_participants_website_domain" CHECK ("grant_participants"."website" = lower("grant_participants"."website") AND char_length("grant_participants"."website") <= 253);--> statement-breakpoint
-- The same privileges as every other table (scripts/sql/roles.sql), granted
-- here as well so they never depend on default privileges. Roles exist only in
-- deployed databases, so this is skipped where they don't.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'signalfeed_ingest') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON company_websites, company_logos TO signalfeed_ingest;
    GRANT USAGE, SELECT ON SEQUENCE company_websites_id_seq TO signalfeed_ingest;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'signalfeed_web') THEN
    GRANT SELECT ON company_websites, company_logos TO signalfeed_web;
  END IF;
END
$$;
