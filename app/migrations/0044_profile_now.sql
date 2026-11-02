ALTER TABLE "profiles" ADD COLUMN "now_record" jsonb;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_now_record_check" CHECK (jsonb_typeof("now_record") = 'object');