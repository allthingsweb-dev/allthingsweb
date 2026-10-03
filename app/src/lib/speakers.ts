import { db } from "./db";
import { blankAvatar } from "@/lib/blank-avatar";
import { type Profile, getSocialUrls } from "./profiles";
import { signImage } from "./image-signing";
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
  const speakers = await Promise.all(
    directory.speakers.map(
      async ({ profile, image, talkIds }): Promise<SpeakerWithTalkIds> => ({
        id: profile.id,
        name: profile.name,
        image: await signImage(image ?? blankAvatar(profile.name)),
        title: profile.title,
        bio: profile.bio,
        type: profile.profileType,
        socials: getSocialUrls(profile),
        talkIds,
      }),
    ),
  );
  return { speakers, talks: directory.talks };
}
