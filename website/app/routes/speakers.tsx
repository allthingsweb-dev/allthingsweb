import { NavLink, useLoaderData } from "@remix-run/react";
import { PageLayout } from "~/modules/components/page-layout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/modules/components/ui/card";
import { Section } from "~/modules/components/ui/section";
import { toReadableDateTimeStr, toYearStr } from "~/modules/datetime";
import {
  getEvents,
  getTalks,
  getSpeakers,
} from "~/modules/pocketbase/api.server";
import { Speaker, Talk } from "~/modules/pocketbase/pocketbase";

type TalkWithEventSlug = Talk & {
  eventName: string;
  eventSlug: string;
  eventStart: Date;
};

type SpeakerWithTalks = Speaker & {
  talks: TalkWithEventSlug[];
};

export async function loader() {
  const [events, talks, speakers] = await Promise.all([
    getEvents(),
    getTalks(),
    getSpeakers(),
  ]);

  const speakersWithTalks: SpeakerWithTalks[] = [];
  for (const speaker of speakers) {
    const speakerTalks = talks.filter((talk) => talk.speakerId === speaker.id);
    if(!speakerTalks.length) {
        continue;
    }
    const talksWithEventInfo: TalkWithEventSlug[] = [];
    for (const talk of speakerTalks) {
      const event = events.find((event) => event.talkIds.includes(talk.id));
      if (!event) {
        continue;
      }
      talksWithEventInfo.push({
        ...talk,
        eventSlug: event.slug,
        eventStart: event.start,
        eventName: event.name,
      });
    }
    speakersWithTalks.push({ ...speaker, talks: talksWithEventInfo });
  }

  // Randomize the order of speakers
  speakersWithTalks.sort(() => Math.random() - 0.5);

  return { speakersWithTalks };
}

export default function Component() {
  const { speakersWithTalks } = useLoaderData<typeof loader>();
  return (
    <PageLayout>
      <Section variant="big">
        <div className="container mx-auto px-4 py-16">
          <div className="flex flex-col justify-center items-center gap-2 mb-16">
            <h1 className="text-3xl font-bold tracking-tighter sm:text-5xl xl:text-6xl/none text-center">
              Speakers
            </h1>
            <p className="max-w-[600px] text-muted-foreground md:text-xl text-center">
              Huge shout-out to all the speakers who have shared their knowledge
              and experience with us. Check out their talks below!
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {speakersWithTalks.map((speaker) => (
              <Card key={speaker.id} className="flex flex-col">
                <CardHeader className="flex flex-row items-center gap-4 pb-2">
                  <img
                    src={speaker.profileImage}
                    alt={speaker.name}
                    width={200}
                    height={200}
                    className="rounded-full w-20 h-20 object-cover"
                  />
                  <div>
                    <CardTitle className="text-xl">{speaker.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {speaker.title}
                    </p>
                  </div>
                </CardHeader>
                <CardContent>
                  <h3 className="text-lg font-semibold mb-2 mt-4">Talks:</h3>
                  <ul className="space-y-2">
                    {speaker.talks.map((talk) => (
                      <li key={talk.id}>
                        <NavLink
                          to={`/${talk.eventSlug}#talks`}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          {talk.title}
                        </NavLink>
                        <p className="text-sm text-muted-foreground">
                          {talk.eventName}{" "}
                          {toYearStr(new Date(talk.eventStart))}
                        </p>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </Section>
    </PageLayout>
  );
}
