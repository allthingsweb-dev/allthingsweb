import { createGateway, generateObject } from "ai";
import type { LumaEvent } from "@/lib/luma";
import {
  aiSuggestedEventSchema,
  type AISuggestedEvent,
  type EventDraft,
} from "../types";

const AI_MODEL = "openai/gpt-5.3-medium";

function getGatewayModel() {
  const gatewayApiKey = process.env.AI_GATEWAY_API_KEY;
  const oidcToken = process.env.VERCEL_OIDC_TOKEN;

  if (!gatewayApiKey && !oidcToken) {
    throw new Error(
      "AI gateway auth missing. Set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN.",
    );
  }

  if (gatewayApiKey) {
    return createGateway({ apiKey: gatewayApiKey })(AI_MODEL);
  }

  return createGateway({
    headers: {
      Authorization: `Bearer ${oidcToken}`,
    },
  })(AI_MODEL);
}

export async function generateEventDraftWithAI({
  lumaEvent,
  derivedDraft,
}: {
  lumaEvent: LumaEvent;
  derivedDraft: EventDraft;
}): Promise<AISuggestedEvent> {
  "use step";

  const { object } = await generateObject({
    model: getGatewayModel(),
    schema: aiSuggestedEventSchema,
    system:
      "You convert Luma events to AllThingsWeb event records. Return realistic, concise values. shortLocation must be a short street/company-style label (for example: 'Mux Office', 'Vercel', 'Market St') and must not be only a city name like 'San Francisco'.",
    prompt: `
Given a Luma event and a deterministic fallback draft, return an improved AllThingsWeb event payload.

Requirements:
- Keep values factual and grounded in the Luma event.
- Keep slug lowercase and URL-safe with hyphens only.
- Tagline should be concise and usable as public event copy.
- attendeeLimit must be a realistic positive integer.
- shortLocation should be a concise street/company/venue label, not just city-only text.
- For unknown optional address fields, return null.

AllThingsWeb required fields:
- name (string)
- slug (string)
- tagline (string)
- attendeeLimit (number)

AllThingsWeb optional location fields:
- streetAddress (string | null)
- shortLocation (string | null)
- fullAddress (string | null)

Luma event JSON:
${JSON.stringify(lumaEvent, null, 2)}

Fallback draft JSON:
${JSON.stringify(derivedDraft, null, 2)}
`,
  });

  return object;
}
