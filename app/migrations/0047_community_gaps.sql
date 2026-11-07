CREATE TABLE "community_gaps" (
	"day" date NOT NULL,
	"source" text NOT NULL,
	"reason" text NOT NULL,
	"tries" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone NOT NULL,
	"last_at" timestamp with time zone NOT NULL,
	CONSTRAINT "community_gaps_day_source_pk" PRIMARY KEY("day","source"),
	CONSTRAINT "community_gaps_source_check" CHECK ("source" IN ('x', 'bluesky', 'youtube', 'discord', 'meetup', 'luma', 'npm', 'github')),
	CONSTRAINT "community_gaps_reason_check" CHECK (length("reason") BETWEEN 1 AND 200),
	CONSTRAINT "community_gaps_tries_check" CHECK ("tries" >= 1),
	CONSTRAINT "community_gaps_last_at_check" CHECK ("last_at" >= "first_at")
);
