import Link from "next/link";
import { Metadata } from "next";
import { mainConfig } from "@/lib/config";
import { PageLayout } from "@/components/page-layout";
import { Section } from "@/components/ui/section";
import { toYearStr } from "@/lib/datetime";
import { ProfileCard } from "@/components/profile-card";
import {
  getSpeakersWithTalks,
  SpeakerWithTalkIds,
  TalkWithEventCtx,
} from "@/lib/speakers";

export async function generateMetadata(): Promise<Metadata> {
  const { speakers } = await getSpeakersWithTalks();
  const speakerCount = speakers.length;

  const title = `Our ${speakerCount} speakers`;
  const description =
    "Huge shout-out to all the speakers who have shared their knowledge and experience with us. Check out their talks from our events!";
  const url = `${mainConfig.instance.origin}/speakers`;
  const imageUrl = `${mainConfig.instance.origin}/api/speakers.png`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: title,
        },
      ],
      type: "website",
      siteName: "All Things Web",
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
      site: "@allthingswebdev",
      creator: "@allthingswebdev",
    },
  };
}

async function getSpeakersData() {
  return await getSpeakersWithTalks();
}

function getTalksOfSpeaker(
  talks: TalkWithEventCtx[],
  speaker: SpeakerWithTalkIds,
) {
  return talks.filter((talk) => speaker.talkIds.includes(talk.id));
}

export default async function SpeakersPage() {
  const { speakers, talks } = await getSpeakersData();

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
            {speakers.map((speaker) => (
              <ProfileCard key={speaker.id} profile={speaker}>
                <>
                  <h3 className="text-lg font-semibold mb-2 mt-4">Talks:</h3>
                  <ul className="space-y-2">
                    {getTalksOfSpeaker(talks, speaker).map((talk) => (
                      <li
                        key={`${speaker.id}-${talk.id}`}
                        className="list-disc ml-6"
                      >
                        <Link
                          href={`/${talk.eventSlug}#talks`}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          {talk.title}
                        </Link>
                        <p className="text-sm text-muted-foreground">
                          {talk.eventName}{" "}
                          {toYearStr(new Date(talk.eventStart))}
                        </p>
                      </li>
                    ))}
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
