import { eq } from "drizzle-orm";
import { blankAvatar } from "@/lib/blank-avatar";
import { db } from "./db";
import { profilesTable, imagesTable } from "./schema";
import { Image } from "./events";
import { signImage } from "./image-signing";
import { getSocialUrls, type Socials } from "./social-links";

export { getSocialUrls, type Socials };

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

export async function getOrganizers(): Promise<Profile[]> {
  const profilesQuery = await db
    .select()
    .from(profilesTable)
    .where(eq(profilesTable.profileType, "organizer"))
    .leftJoin(imagesTable, eq(profilesTable.image, imagesTable.id));

  const transformToProfile = async (row: any): Promise<Profile> => {
    const profile = row.profiles;
    const imageRaw = row.images ?? blankAvatar(profile.name);

    const image = await signImage(imageRaw);

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
  };

  return await Promise.all(profilesQuery.map(transformToProfile));
}
