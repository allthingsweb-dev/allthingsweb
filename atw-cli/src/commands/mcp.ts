import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import packageJson from "../../package.json";
import { Command } from "commander";
import { z } from "zod";
import { registerAction, type Event } from "../actions/register";
import type { AtwZero } from "../core/create-zero";
import { sleep } from "bun";

type Deps = {
  zero: AtwZero;
};

export const createMCPServeCommand = ({ zero }: Deps): Command => {
  const command = new Command("mcp-serve")
    .description("Start the MCP server.")
    .action(async () => {
      const mcpServer = new McpServer({
        name: "All Things Web meetup events",
        version: packageJson.version,
      });

      mcpServer.tool(
        "get-events",
        "Get all upcoming published All Things Web events",
        {},
        async () => {
          const getEvents = async (): Promise<Event[]> => {
            let count = 0;
            return new Promise(async (resolve) => {
              for (let i = 0; i < 10; i++) {
                const events = zero.query.events
                  .where("startDate", ">", new Date().getTime())
                  .orderBy("startDate", "desc")
                  .limit(10)
                  .run();
                if (!events.length) {
                  count += 1;
                  await sleep(200);
                } else {
                  resolve(events);
                }
              }
            });
          };
          const events = await getEvents();
          return {
            content: events.map((event) => ({
              type: "text",
              text: `
             name: ${event.name}
             start: ${event.startDate}
             location: ${event.shortLocation}
             tagline: ${event.tagline}
             eventId: ${event.id}`,
            })),
          };
        },
      );

      mcpServer.tool(
        "register",
        "Register to an All Things Web event",
        {
          eventId: z.string().describe("The event id to register to."),
          email: z.string().email().describe("The email to register with."),
        },
        async ({ eventId, email }) => {
          const results = await registerAction(email, eventId);
          let text = "Registered!";
          if (results.success === false) {
            text = `Oh no! Something went wrong! ${results.error}`;
          }
          return {
            content: [
              { type: "text", text },
              { type: "text", text: `eventId: ${eventId}` },
            ],
          };
        },
      );

      const stdioServer = new StdioServerTransport();
      await mcpServer.connect(stdioServer);
    });
  return command;
};
