import { Route } from "./+types/api.speakers";

export async function loader({ context }: Route.ActionArgs) {
    const speakersWithTalks = await context.queryClient.getSpeakersWithTalks();
    const data = speakersWithTalks.speakers.map((speaker) => ({
        name: speaker.name,
    }));
    return Response.json({ success: true, data });
}