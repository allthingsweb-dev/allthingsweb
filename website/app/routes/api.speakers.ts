import { Route } from "./+types/api.speakers";

export async function loader({ context }: Route.ActionArgs) {
  const speakersWithTalks = await context.queryClient.getSpeakersWithTalks();
  const data = speakersWithTalks.speakers.map((speaker) => ({
    name: speaker.name,
    title: speaker.title,
    link:
      speaker.socials.linkedinUrl ||
      speaker.socials.twitterUrl ||
      speaker.socials.blueskyUrl,
  }));
  return Response.json({ success: true, data });
}
