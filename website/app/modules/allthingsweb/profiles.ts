import { Socials } from "./socials";
import { Image } from "./images";

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
