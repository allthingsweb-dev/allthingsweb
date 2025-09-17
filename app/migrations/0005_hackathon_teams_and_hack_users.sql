-- Add team & project fields and team image to hacks
DO $$ BEGIN
  -- Rename existing columns to match new schema
  ALTER TABLE "hacks" RENAME COLUMN "name" TO "team_name";
EXCEPTION WHEN undefined_column THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "hacks" RENAME COLUMN "description" TO "project_description";
EXCEPTION WHEN undefined_column THEN NULL; END $$;--> statement-breakpoint

-- Add new columns if not present
DO $$ BEGIN
  ALTER TABLE "hacks" ADD COLUMN "project_name" text;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "hacks" ADD COLUMN "team_image" uuid;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;--> statement-breakpoint

-- Add FK to images for team_image (set null on delete)
DO $$ BEGIN
  ALTER TABLE "hacks" ADD CONSTRAINT "hacks_team_image_images_id_fk" FOREIGN KEY ("team_image") REFERENCES "public"."images"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- Ensure team_name is not null (populate from old values if needed)
UPDATE "hacks" SET "team_name" = COALESCE("team_name", 'Team');
ALTER TABLE "hacks" ALTER COLUMN "team_name" SET NOT NULL;--> statement-breakpoint

-- Update hack_users to use user_id instead of clerk_user_id
DO $$ BEGIN
  ALTER TABLE "hack_users" RENAME COLUMN "clerk_user_id" TO "user_id";
EXCEPTION WHEN undefined_column THEN NULL; END $$;--> statement-breakpoint

-- Replace composite PK to use user_id
DO $$ BEGIN
  ALTER TABLE "hack_users" DROP CONSTRAINT "hack_users_hack_id_clerk_user_id_pk";
EXCEPTION WHEN undefined_object THEN NULL; END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "hack_users" ADD CONSTRAINT "hack_users_hack_id_user_id_pk" PRIMARY KEY ("hack_id", "user_id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

-- Update hack_votes to use user_id instead of clerk_user_id
DO $$ BEGIN
  ALTER TABLE "hack_votes" RENAME COLUMN "clerk_user_id" TO "user_id";
EXCEPTION WHEN undefined_column THEN NULL; END $$;--> statement-breakpoint

