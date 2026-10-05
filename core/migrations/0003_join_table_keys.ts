import { statements } from "./statements.ts";

/**
 * Primary keys on the two join tables production has none on: a host is
 * attached to an event once, a speaker to a talk once. The app's drizzle
 * schema and app/migrations 0000 already have both keys, under these names;
 * production lost them by hand (tests/migrations.test.ts listed the
 * difference until now), so no drizzle migration goes with this one.
 *
 * Duplicate pairs would make the keys impossible. Rather than delete any
 * row, the migration then fails, listing every duplicate, and changes
 * nothing; remove the extra rows by hand and migrate again. The tables are
 * locked first, so no duplicate can arrive between the check and the keys.
 */
export const joinTableKeys: ReadonlyArray<string> = [
  `LOCK TABLE "public"."event_sponsors", "public"."talk_speakers" IN ACCESS EXCLUSIVE MODE`,
  `DO $check$
  DECLARE
    duplicates text;
  BEGIN
    SELECT string_agg(line, E'\\n' ORDER BY line) INTO duplicates FROM (
      SELECT format('event_sponsors: event_id %s, sponsor_id %s (%s rows)', event_id, sponsor_id, count(*)) AS line
      FROM "public"."event_sponsors"
      GROUP BY event_id, sponsor_id
      HAVING count(*) > 1
      UNION ALL
      SELECT format('talk_speakers: talk_id %s, speaker_id %s (%s rows)', talk_id, speaker_id, count(*))
      FROM "public"."talk_speakers"
      GROUP BY talk_id, speaker_id
      HAVING count(*) > 1
    ) found;
    IF duplicates IS NOT NULL THEN
      RAISE EXCEPTION 'Duplicate rows stop the join tables'' primary keys; nothing was changed. Keep one row of each pair, delete the rest by hand, then migrate again:%', E'\\n' || duplicates;
    END IF;
  END
  $check$`,
  `ALTER TABLE "public"."event_sponsors" ADD CONSTRAINT "event_sponsors_event_id_sponsor_id_pk" PRIMARY KEY ("event_id", "sponsor_id")`,
  `ALTER TABLE "public"."talk_speakers" ADD CONSTRAINT "talk_speakers_talk_id_speaker_id_pk" PRIMARY KEY ("talk_id", "speaker_id")`,
];

export default statements(joinTableKeys);
