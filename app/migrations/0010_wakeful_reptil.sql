CREATE TABLE IF NOT EXISTS "neon_auth"."users_sync" (
	"raw_json" jsonb NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text,
	"created_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"updated_at" timestamp with time zone
);