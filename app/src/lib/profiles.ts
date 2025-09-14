import { eq } from "drizzle-orm";
import { db } from "./db";
import { profilesTable, imagesTable } from "./schema";
import { Image } from "./events";

export type Socials = {
  twitterUrl: string | null;
  linkedinUrl: string | null;
  blueskyUrl: string | null;
};

export type Profile = {
  id: string;
  name: string;
  image: Image;
  title: string | null;
  bio: string | null;
  type: "member" | "organizer";
  socials: Socials;
};

export function organizeByType(members: Profile[]) {
  const organizers = members.filter((member) => member.type === "organizer");
  const attendees = members.filter((member) => member.type === "member");
  return { organizers, attendees };
}

export function getSocialUrls(socials: {
  linkedinHandle?: string | null | undefined;
  twitterHandle?: string | null | undefined;
  blueskyHandle?: string | null | undefined;
}): Socials {
  return {
    linkedinUrl: socials.linkedinHandle
      ? `https://www.linkedin.com/in/${socials.linkedinHandle}`
      : null,
    twitterUrl: socials.twitterHandle
      ? `https://twitter.com/${socials.twitterHandle}`
      : null,
    blueskyUrl: socials.blueskyHandle
      ? `https://bsky.app/profile/${socials.blueskyHandle}`
      : null,
  };
}

export async function getOrganizers(): Promise<Profile[]> {
  const profilesQuery = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.profileType, "organizer"))
    .leftJoin(imagesTable, eq(profilesTable.image, imagesTable.id));

  return profilesQuery.map((row): Profile => {
    const profile = row.profiles;
    const image = row.images || {
      url: "/hero-image-rocket.png",
      alt: `${profile.name} profile picture`,
      placeholder: null,
      width: 400,
      height: 400,
    };

    return {
      id: profile.id,
      name: profile.name,
      image,
      title: profile.title,
      bio: profile.bio,
      type: profile.profileType,
      socials: getSocialUrls({
        twitterHandle: profile.twitterHandle,
        linkedinHandle: profile.linkedinHandle,
        blueskyHandle: profile.blueskyHandle,
      }),
    };
  });
}
