ALTER TABLE "administrators" DROP CONSTRAINT "administrators_user_id_users_sync_id_fk";
--> statement-breakpoint
ALTER TABLE "event_images" DROP CONSTRAINT "event_images_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "event_images" DROP CONSTRAINT "event_images_image_id_images_id_fk";
--> statement-breakpoint
ALTER TABLE "event_sponsors" DROP CONSTRAINT "event_sponsors_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "event_sponsors" DROP CONSTRAINT "event_sponsors_sponsor_id_sponsors_id_fk";
--> statement-breakpoint
ALTER TABLE "event_talks" DROP CONSTRAINT "event_talks_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "event_talks" DROP CONSTRAINT "event_talks_talk_id_talks_id_fk";
--> statement-breakpoint
ALTER TABLE "hack_users" DROP CONSTRAINT "hack_users_hack_id_hacks_id_fk";
--> statement-breakpoint
ALTER TABLE "hack_votes" DROP CONSTRAINT "hack_votes_hack_id_hacks_id_fk";
--> statement-breakpoint
ALTER TABLE "hacks" DROP CONSTRAINT "hacks_event_id_events_id_fk";
--> statement-breakpoint
ALTER TABLE "profile_users" DROP CONSTRAINT "profile_users_profile_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "profile_users" DROP CONSTRAINT "profile_users_user_id_users_sync_id_fk";
--> statement-breakpoint
ALTER TABLE "talk_speakers" DROP CONSTRAINT "talk_speakers_talk_id_talks_id_fk";
--> statement-breakpoint
ALTER TABLE "talk_speakers" DROP CONSTRAINT "talk_speakers_speaker_id_profiles_id_fk";
--> statement-breakpoint
ALTER TABLE "administrators" ADD CONSTRAINT "administrators_user_id_users_sync_id_fk" FOREIGN KEY ("user_id") REFERENCES "neon_auth"."users_sync"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_images" ADD CONSTRAINT "event_images_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_images" ADD CONSTRAINT "event_images_image_id_images_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sponsors" ADD CONSTRAINT "event_sponsors_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_sponsors" ADD CONSTRAINT "event_sponsors_sponsor_id_sponsors_id_fk" FOREIGN KEY ("sponsor_id") REFERENCES "public"."sponsors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_talks" ADD CONSTRAINT "event_talks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_talks" ADD CONSTRAINT "event_talks_talk_id_talks_id_fk" FOREIGN KEY ("talk_id") REFERENCES "public"."talks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hack_users" ADD CONSTRAINT "hack_users_hack_id_hacks_id_fk" FOREIGN KEY ("hack_id") REFERENCES "public"."hacks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hack_votes" ADD CONSTRAINT "hack_votes_hack_id_hacks_id_fk" FOREIGN KEY ("hack_id") REFERENCES "public"."hacks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hacks" ADD CONSTRAINT "hacks_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_users" ADD CONSTRAINT "profile_users_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_users" ADD CONSTRAINT "profile_users_user_id_users_sync_id_fk" FOREIGN KEY ("user_id") REFERENCES "neon_auth"."users_sync"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talk_speakers" ADD CONSTRAINT "talk_speakers_talk_id_talks_id_fk" FOREIGN KEY ("talk_id") REFERENCES "public"."talks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talk_speakers" ADD CONSTRAINT "talk_speakers_speaker_id_profiles_id_fk" FOREIGN KEY ("speaker_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;