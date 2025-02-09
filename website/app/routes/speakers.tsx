import { NavLink, useLoaderData } from "react-router";
import { PageLayout } from "~/modules/components/page-layout";
import { Section } from "~/modules/components/ui/section";
import { toYearStr } from "~/modules/datetime";
import { getMetaTags } from "~/modules/meta";
import { ProfileCard } from "~/modules/profiles/components";
import { Route } from "./+types/speakers";
import {
  SpeakerWithTalkIds,
  TalkWithEventCtx,
} from "~/modules/allthingsweb/speakers";

export { headers } from "~/modules/header.server";

export const meta: Route.MetaFunction = ({ data, matches }) => {
  const rootMatch = matches.find((match) => match && match.id === "root");
  if (!rootMatch || !rootMatch.data) {
    return [{ title: "Speakers not found" }];
  }
  if (!rootMatch.data) {
    return [{ title: "Speakers not found" }, ...rootMatch.meta];
  }
  const rootData = (rootMatch as Route.MetaArgs["matches"][0]).data;
  const title = `Our ${data.speakersWithTalks.speakers.length} speakers`;
  const description =
    "Huge shout-out to all the speakers who have shared their knowledge and experience with us. Check out their talks from our events!";
  const previewImageUrl = `${rootData.serverOrigin}/speakers.png`;
  return [
    ...getMetaTags(title, description, "/speakers", previewImageUrl),
    ...rootMatch.meta,
  ];
};

export async function loader({ context }: Route.LoaderArgs) {
  return {
    speakersWithTalks: await context.queryClient.getSpeakersWithTalks(),
  };
}

function getTalksOfSpeaker(
  talks: TalkWithEventCtx[],
  speaker: SpeakerWithTalkIds,
) {
  return talks.filter((talk) => speaker.talkIds.includes(talk.id));
}

export default function Component() {
  const { speakersWithTalks } = useLoaderData<typeof loader>();
  return (
    <PageLayout>
      <Section variant="big">
        <div className="container">
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
            {speakersWithTalks.speakers.map((speaker) => (
              <ProfileCard key={speaker.id} profile={speaker}>
                <>
                  <h3 className="text-lg font-semibold mb-2 mt-4">Talks:</h3>
                  <ul className="space-y-2">
                    {getTalksOfSpeaker(speakersWithTalks.talks, speaker).map(
                      (talk) => (
                        <li key={talk.id} className="list-disc ml-6">
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
                      ),
                    )}
                  </ul>
                </>
              </ProfileCard>
            ))}
          </div>
        </div>
      </Section>
    </PageLayout>
  );
}
