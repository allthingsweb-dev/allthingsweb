CREATE TABLE "community_metrics" (
	"day" date NOT NULL,
	"source" text NOT NULL,
	"metric" text NOT NULL,
	"value" bigint NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_metrics_day_source_metric_pk" PRIMARY KEY("day","source","metric"),
	CONSTRAINT "community_metrics_source_check" CHECK ("source" IN ('x', 'bluesky', 'youtube', 'discord', 'meetup', 'luma', 'npm', 'github')),
	CONSTRAINT "community_metrics_metric_check" CHECK ("metric" ~ '^[a-z][a-z_]{0,31}$'),
	CONSTRAINT "community_metrics_value_check" CHECK ("value" >= 0)
);
