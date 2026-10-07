import { captureException } from "@sentry/nextjs";
import { createMcpHandler } from "mcp-handler";
import { mainConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { getExpandedEventBySlug } from "@/lib/expanded-events";
import { registerAtwTools } from "@/lib/mcp/tools";
import { getPublishedEvents } from "@/lib/published-events";
import { getSpeakerDirectory } from "@/lib/speaker-directory";
import packageJson from "../../../package.json";

export const runtime = "nodejs";

const handler = createMcpHandler(
  (server) =>
    registerAtwTools(server, {
      origin: mainConfig.instance.origin,
      now: () => new Date(),
      listPublishedEvents: getPublishedEvents,
      getEventBySlug: getExpandedEventBySlug,
      getSpeakerDirectory: () => getSpeakerDirectory(db),
      reportError: (error, tool) =>
        captureException(error, { tags: { mcpTool: tool } }),
    }),
  {
    serverInfo: {
      name: "allthings",
      version: packageJson.version,
    },
  },
);

export { handler as GET, handler as POST };
