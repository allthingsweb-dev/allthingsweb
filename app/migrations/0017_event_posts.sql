-- Posts about each event on social platforms; core/migrations/0005_event_posts.ts is the same change.
CREATE TABLE "event_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"url" text NOT NULL,
	"author_name" text NOT NULL,
	"author_handle" text,
	"author_url" text,
	"author_avatar_source_url" text,
	"author_avatar" uuid,
	"posted_at" timestamp with time zone NOT NULL,
	"text" text NOT NULL,
	"image_source_url" text,
	"image" uuid,
	"status" text DEFAULT 'approved' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "event_posts_url_unique" UNIQUE("url"),
	CONSTRAINT "event_posts_platform_check" CHECK ("platform" IN ('x', 'bluesky', 'linkedin', 'other')),
	CONSTRAINT "event_posts_status_check" CHECK ("status" IN ('approved', 'hidden', 'pending'))
);
--> statement-breakpoint
ALTER TABLE "event_posts" ADD CONSTRAINT "event_posts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_posts" ADD CONSTRAINT "event_posts_author_avatar_images_id_fk" FOREIGN KEY ("author_avatar") REFERENCES "public"."images"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_posts" ADD CONSTRAINT "event_posts_image_images_id_fk" FOREIGN KEY ("image") REFERENCES "public"."images"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_posts_event_id_idx" ON "event_posts" USING btree ("event_id");