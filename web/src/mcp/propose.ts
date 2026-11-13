import type { CallToolResult } from "@modelcontextprotocol/server";
import type { IntakeSource } from "allthings-core/src/proposal-intake.ts";
import { proposalLimits } from "allthings-core/src/proposals.ts";
import { Effect } from "effect";
import { z } from "zod";
import { outcomeMessages, takeProposal } from "../proposals.ts";

/**
 * `propose_talk`, the MCP server's one tool that writes: a talk proposal,
 * taken as the site takes every one (src/proposals.ts's takeProposal:
 * the rate limit, core's readProposal, then kept as proposal_intake on
 * prod). It reads nothing back, so its answer is only whether the proposal
 * was taken, or each problem with it. It is never answered through the
 * page store (endpoint.ts): each call runs, and none is kept.
 *
 * Its input schema says the shape and the most each field may be, so a
 * client can't send more; readProposal says, in words, what else is wrong.
 */

export const proposeToolName = "propose_talk";

/** propose_talk's input, as MCP clients send it. */
export const proposeInput = z.object({
  title: z
    .string()
    .max(proposalLimits.title)
    .describe("The talk's title, on one line."),
  abstract: z
    .string()
    .max(proposalLimits.abstract)
    .describe(
      `What the talk is about, and what people will leave knowing: a few sentences, at least ${proposalLimits.abstractMin} characters.`,
    ),
  format: z
    .enum(["talk", "lightning", "demo"])
    .default("talk")
    .describe(
      "talk (about 20 minutes), lightning (about 5) or demo (about 10).",
    ),
  name: z
    .string()
    .max(proposalLimits.name)
    .describe("The speaker's name, as they'd like it on the evening."),
  email: z
    .string()
    .max(proposalLimits.email)
    .describe(
      "The speaker's email: where the organizers reply. Only they see it.",
    ),
  about: z
    .string()
    .max(proposalLimits.about)
    .optional()
    .describe("A few lines about the speaker: what they build, and where."),
  links: z
    .array(z.string().max(proposalLimits.link))
    .max(proposalLimits.links)
    .optional()
    .describe(
      "Up to four https links: their site, GitHub, the project the talk is about.",
    ),
  notes: z
    .string()
    .max(proposalLimits.notes)
    .optional()
    .describe(
      "Anything else for the organizers: dates that work, a co-speaker.",
    ),
});

/** The tool's description, as clients list it. */
export const proposeDescription =
  "Propose a talk for an allthings evening in San Francisco. Anyone may propose; Erik and Andre read every proposal and reply by email, and pick the talks people will still talk about on the way home: something built, broken or worked out the hard way, open source above all, never a product pitch. Send it only with the speaker's own details, at their asking: it keeps their name and email privately, shows nothing back, and nothing about it appears on allthings.dev unless they give the talk.";

/** propose_talk's answer: taken, or why not, in words for the person asking. */
export const proposeProgram = (
  input: unknown,
  source: IntakeSource,
  client: string,
): Effect.Effect<CallToolResult> =>
  Effect.map(takeProposal(input, source, client), (outcome) => {
    if (outcome._tag === "Kept") {
      const answer = { received: true, message: outcomeMessages.Kept };
      return {
        content: [{ type: "text", text: JSON.stringify(answer, null, 2) }],
        structuredContent: answer,
      };
    }
    const text =
      outcome._tag === "Invalid"
        ? [
            outcomeMessages.Invalid,
            ...outcome.problems.map(
              (problem) => `${problem.field}: ${problem.message}`,
            ),
          ].join("\n")
        : outcomeMessages[outcome._tag];
    return { isError: true, content: [{ type: "text", text }] };
  });

/** Where a call came from: the `allthings` command names itself; anything else is an MCP client. */
export const sourceOf = (request: Request): IntakeSource =>
  (request.headers.get("user-agent") ?? "").startsWith("allthings-cli/")
    ? "cli"
    : "mcp";
