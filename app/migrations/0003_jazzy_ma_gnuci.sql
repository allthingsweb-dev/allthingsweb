ALTER TABLE "profile_users" DROP COLUMN "id";
ALTER TABLE "profile_users" ADD CONSTRAINT "profile_users_profile_id_user_id_pk" PRIMARY KEY("profile_id","user_id");--> statement-breakpoint
