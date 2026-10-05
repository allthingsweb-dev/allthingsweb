import type { Foundations } from "../scripts/build.ts";
import source from "../dist/foundations.json" with { type: "json" };

/**
 * brand/foundations.md as HTML, as web/scripts/build.ts wrote it. Only
 * /brand shows it, and that page is loaded when it is first asked for (see
 * pages/routes.ts), so the foundations stay out of every cold start.
 */
export const foundations: Foundations = source;
