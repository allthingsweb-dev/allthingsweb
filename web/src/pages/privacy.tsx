import type { PortraitsById } from "allthings-core/src/portraits.ts";
import { Document } from "./document.tsx";
import { gatheringTitle } from "./metadata.tsx";
import type { ImageMode } from "./picture.tsx";
import { ogCards } from "../og/cards.ts";
import type { Theme } from "./theme.ts";
import { simpleDate } from "./time.ts";

/**
 * /privacy: what the site keeps about the people who visit it and the
 * people it shows, and how to have something changed or taken down. Every
 * sentence states what the code does: web-analytics.ts (the beacon),
 * metrics.ts (the anonymous counts), pages/theme.ts (the one cookie),
 * core's src/luma/api.ts (guest counts, never the list), the people
 * pipeline (core's README, "Filling in profiles"; docs/now.md) and
 * mcp/endpoint.ts (answers kept by the question, not the asker). Change
 * the page, and `updated`, when any of those changes.
 */

export interface PrivacyProps {
  /** The production origin, which the page's canonical URL is made from. */
  readonly origin: string;
  readonly theme: Theme | undefined;
  /** The hosts' portraits, for the footer. */
  readonly portraits: PortraitsById;
  readonly images: ImageMode;
}

/** Where the privacy page is. */
export const privacyPath = "/privacy";

/** When the page last changed, as YYYY-MM-DD. */
export const privacyUpdated = "2026-11-10";

/** Where privacy requests go. */
export const privacyEmail = "hello@allthings.dev";

const lumaPrivacy = "https://luma.com/privacy-policy";
const cloudflarePrivacy = "https://www.cloudflare.com/privacypolicy/";

/** The privacy page, whole, in the site's frame. */
export function privacyPage({
  origin,
  theme,
  portraits,
  images,
}: PrivacyProps): string {
  return Document({
    meta: {
      title: gatheringTitle("privacy"),
      description:
        "What allthings.dev keeps about you, and how to have it changed or taken down.",
      path: privacyPath,
      image: ogCards.privacy,
    },
    origin,
    theme,
    portraits,
    images,
    children: (
      <article class="privacy">
        <div class="intro">
          <h1 class="lockup at-type-event-lockup">privacy</h1>
          <p class="lead at-type-lead">
            allthings.dev needs no account and shows no ads. Here is what it
            keeps, and why.
          </p>
          <p class="at-type-meta">
            updated{" "}
            <time datetime={privacyUpdated} safe>
              {simpleDate(privacyUpdated)}
            </time>
          </p>
        </div>
        <div class="prose">
          <h2 id="visiting">Visiting the site</h2>
          <ul>
            <li>
              Cloudflare runs the site. Its Web Analytics counts page views,
              where visitors came from and how fast pages load. It sets no
              cookie. See{" "}
              <a href={cloudflarePrivacy}>Cloudflare's privacy policy</a>.
            </li>
            <li>
              For each request the site answers, we count the page, how it
              answered, how long it took, the data center, and whether it looked
              like a bot. Never your IP address, browser, cookies or the page
              you came from. We keep these counts for three months.
            </li>
            <li>
              Cloudflare's logs keep each request's URL for 7 days, so we can
              fix what breaks.
            </li>
            <li>
              The one cookie, <code>theme</code>, holds Paper or Night, and only
              once you choose one.
            </li>
          </ul>
          <h2 id="evenings">Evenings</h2>
          <p>
            You say you're in, and subscribe to the calendar, on Luma, which
            keeps your details under{" "}
            <a href={lumaPrivacy}>Luma's privacy policy</a>. This site never
            copies the guest list: from Luma it reads each evening's details,
            who hosts it, and how many people said they're in and checked in.
          </p>
          <p>
            Hosts and speakers we invite to help plan an evening sign in with
            their email, through Cloudflare Access, to see that evening's draft.
          </p>
          <h2 id="people">People on the site</h2>
          <p>
            Everyone who organized, spoke at or co-hosted an evening has a page:
            their name, photo, job title, a short bio, links to their profiles,
            the talks they gave and a few of their posts on X. All of it is
            public, read from their own sites and profiles, their talks, Luma,
            and company or conference pages, and we keep where each fact came
            from. An evening's page shows photos from that evening, and posts
            people wrote about it once an organizer approves them.
          </p>
          <h2 id="agents">The API, the MCP server and the command</h2>
          <p>
            <code>/api</code>, <code>/mcp</code> and the <code>allthings</code>{" "}
            command's reads show only what the pages already show. They need no
            account or key, and their requests are counted and logged like any
            page's. To answer quickly, the site keeps each answer under the
            question asked, never under who asked it.
          </p>
          <p>
            At an evening that passes the aux, <code>allthings aux</code> sets
            the room's lights or music with the code on your card, which the
            command saves on your machine. The hub, on the host's laptop, logs
            each call by the code's id, never your name, with only the choices
            it knows (a scene, color, zone or track), never other text you type.
            The host sees the latest calls.
          </p>
          <h2 id="elsewhere">Our accounts elsewhere</h2>
          <p>
            We post about evenings from our own accounts on X, Bluesky, LinkedIn
            and Discord. Where we use a platform's API, it is to post as
            allthings and to read public data: posts about our evenings, and
            speakers' posts and follower counts on X, which order speaker lists.
          </p>
          <h2 id="requests">Changes and questions</h2>
          <p>
            Email <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a> to
            change or take down anything about you, a photo included, or to ask
            about any of this.
          </p>
        </div>
      </article>
    ),
  });
}
