import { buildContainer } from "~/modules/container.server";

const slug = "2024-10-05-hackathon-at-sentry";

async function main() {
  const container = buildContainer();
  const event = await container.cradle.queryClient.getEventBySlug(slug);
  if (!event) {
    console.error("Event not found");
    return;
  }
  console.log(event);
}

main();
