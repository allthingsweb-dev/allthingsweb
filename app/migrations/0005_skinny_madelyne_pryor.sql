ALTER TABLE "hack_users" DROP CONSTRAINT "hack_users_hack_id_clerk_user_id_pk";--> statement-breakpoint
ALTER TABLE "hack_users" ADD CONSTRAINT "hack_users_hack_id_user_id_pk" PRIMARY KEY("hack_id","user_id");--> statement-breakpoint 
ALTER TABLE "hack_users" ADD COLUMN "user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "hack_votes" ADD COLUMN "user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "hacks" ADD COLUMN "team_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "hacks" ADD COLUMN "project_name" text;--> statement-breakpoint
ALTER TABLE "hacks" ADD COLUMN "project_description" text;--> statement-breakpoint
ALTER TABLE "hacks" ADD COLUMN "team_image" uuid;--> statement-breakpoint
ALTER TABLE "hack_users" ADD CONSTRAINT "hack_users_user_id_users_sync_id_fk" FOREIGN KEY ("user_id") REFERENCES "neon_auth"."users_sync"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hack_votes" ADD CONSTRAINT "hack_votes_user_id_users_sync_id_fk" FOREIGN KEY ("user_id") REFERENCES "neon_auth"."users_sync"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hacks" ADD CONSTRAINT "hacks_team_image_images_id_fk" FOREIGN KEY ("team_image") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hack_users" DROP COLUMN "clerk_user_id";--> statement-breakpoint
ALTER TABLE "hack_votes" DROP COLUMN "clerk_user_id";--> statement-breakpoint
ALTER TABLE "hacks" DROP COLUMN "name";--> statement-breakpoint
ALTER TABLE "hacks" DROP COLUMN "description";