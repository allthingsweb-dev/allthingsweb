-- all things/<topic> set on the site; core/migrations/0002_event_topic.ts is the same change. Then the topics of the published events whose names yield none, by Luma id.
ALTER TABLE "events" ADD COLUMN "topic" text;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_topic_check" CHECK (char_length("topic") <= 24
    AND "topic" IS NFC NORMALIZED
    AND "topic" = lower("topic" COLLATE "pg_c_utf8")
    AND strpos("topic", 'all things') = 0
    AND "topic" COLLATE "pg_c_utf8" ~ '^[[:alpha:][:digit:]](?:[[:alpha:][:digit:].&+#'']|(?<=[^ ]) (?=[^ ])|(?<=[[:alpha:][:digit:]])-(?=[[:alpha:][:digit:]]))*$');--> statement-breakpoint
UPDATE "events" SET "topic" = 'dev setups' WHERE "luma_event_id" = 'evt-wJxtorPCscwoGS4';--> statement-breakpoint
UPDATE "events" SET "topic" = 'typescript ai afterparty' WHERE "luma_event_id" = 'evt-ITMJYP0vdkjXbMr';--> statement-breakpoint
UPDATE "events" SET "topic" = 'react native after-party' WHERE "luma_event_id" = 'evt-TpDFOGNSBwCxU72';--> statement-breakpoint
UPDATE "events" SET "topic" = 'ship ai' WHERE "luma_event_id" = 'evt-lPPnQypydANrkrJ';--> statement-breakpoint
UPDATE "events" SET "topic" = 'ai' WHERE "luma_event_id" = 'evt-hMrMdGcrk8XOnuF';