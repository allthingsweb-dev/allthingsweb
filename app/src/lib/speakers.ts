import { db } from "./db";
import { blankAvatar } from "@/lib/blank-avatar";
import { type Profile, getSocialUrls } from "./profiles";
import { getSpeakerDirectory } from "./speaker-directory";

export type TalkWithEventCtx = Awaited<
  ReturnType<typeof getSpeakerDirectory>
>["talks"][number];
export type SpeakerWithTalkIds = Profile & { talkIds: string[] };

export async function getSpeakersWithTalks(): Promise<{
  speakers: SpeakerWithTalkIds[];
  talks: TalkWithEventCtx[];
}> {
  const directory = await getSpeakerDirectory(db);
  const speakers = directory.speakers.map(
    ({ profile, image, talkIds }): SpeakerWithTalkIds => ({
      id: profile.id,
      name: profile.name,
      image: image ?? blankAvatar(profile.name),
      title: profile.title,
      bio: profile.bio,
      type: profile.profileType,
      socials: getSocialUrls(profile),
      talkIds,
    }),
  );
  return { speakers, talks: directory.talks };
}
