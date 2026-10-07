#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { completenessReport } from "./completeness.js";
import { addEventPhotos, replaceEventPhoto } from "./event-photos.js";
import { addEventPost } from "./event-posts.js";
import { approvePost, hidePost, listPendingPosts } from "./post-review.js";
import { promoChannels, promoDrafts } from "./promo.js";
import { isPlanTool, planTool, planToolDefinitions } from "./plan.js";
import { draftReadiness, draftReadinessTool } from "./readiness.js";
import { isLumaTool, lumaTool, lumaToolDefinitions } from "./luma-studio.js";
import {
  createEvent,
  getEventBySlug,
  updateEvent,
  findProfileByName,
  createProfile,
  updateProfile,
  updateProfileById,
  setProfileImage,
  createTalk,
  updateTalk,
  addTalkToEvent,
  removeTalkFromEvent,
  findTalksBySpeakerName,
  createHost,
  addHostToEvent,
  getImgIdsForUrls,
  deleteEventImages,
  deleteOrphanedImage,
  addImagesToEvent,
  addUserToAdmins,
  removeUserFromAdmins,
  listAdmins,
  getLumaEvent,
} from "./functions.js";

// Zod schemas for function parameters
const CreateEventSchema = z.object({
  name: z.string(),
  slug: z.string(),
  attendeeLimit: z.number(), // Required in schema
  tagline: z.string(), // Required in schema
  startDate: z.string(), // Keep as string, functions will handle conversion
  endDate: z.string(), // Keep as string, functions will handle conversion
  lumaEventId: z.string().optional(),
  isDraft: z.boolean().optional(),
  isHackathon: z.boolean().optional(),
  highlightOnLandingPage: z.boolean().optional(),
  fullAddress: z.string().optional(),
  shortLocation: z.string().optional(),
  streetAddress: z.string().optional(),
});

const UpdateEventSchema = z.object({
  name: z.string().optional(),
  slug: z.string().optional(),
  attendeeLimit: z.number().optional(),
  tagline: z.string().optional(),
  startDate: z.string().optional(), // Keep as string, functions will handle conversion
  endDate: z.string().optional(), // Keep as string, functions will handle conversion
  lumaEventId: z.string().optional(),
  isDraft: z.boolean().optional(),
  isHackathon: z.boolean().optional(),
  highlightOnLandingPage: z.boolean().optional(),
  fullAddress: z.string().optional(),
  shortLocation: z.string().optional(),
  streetAddress: z.string().optional(),
  recordingUrl: z.string().optional(),
});

const InsertProfileSchema = z.object({
  name: z.string(),
  title: z.string(), // Required in schema
  bio: z.string(), // Required in schema
  linkedinHandle: z.string().optional(),
  twitterHandle: z.string().optional(),
  profileType: z.enum(["member", "organizer"]), // Only "member" and "organizer" in enum
});

const InsertTalkSchema = z.object({
  title: z.string(),
  description: z.string(), // Required in schema
});

const UpdateTalkSchema = z.object({
  talkId: z.string(),
  talkData: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
  }),
});

const InsertHostSchema = z.object({
  name: z.string(),
  about: z.string(), // Required in schema
});

const AddEventPostSchema = z.object({
  slug: z.string().min(1),
  url: z.string().min(1),
  authorName: z.string().optional(),
  authorUrl: z.string().optional(),
  text: z.string().optional(),
});

const AddEventPhotosSchema = z.object({
  slug: z.string().min(1),
  files: z.array(z.string().min(1)).min(1),
  alts: z.array(z.string().min(1)).min(1),
  dryRun: z.boolean().optional(),
});

const ReplaceEventPhotoSchema = z.object({
  slug: z.string().min(1),
  photo: z.string().min(1),
  file: z.string().min(1),
  alt: z.string().min(1),
  dryRun: z.boolean().optional(),
});

const PendingPostsSchema = z.object({ slug: z.string().min(1).optional() });
const PostUrlSchema = z.object({ url: z.string().min(1) });

const GetPromoDraftsSchema = z.object({
  slug: z.string().min(1),
  channels: z.array(z.enum(promoChannels)).optional(),
  json: z.boolean().optional(),
});

const server = new Server(
  {
    name: "allthingsweb-scripts",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// Tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Event tools
      {
        name: "create_event",
        description: "Create a new event",
        inputSchema: {
          type: "object",
          properties: {
            event: {
              type: "object",
              properties: {
                name: { type: "string", description: "Event name" },
                slug: {
                  type: "string",
                  description: "URL-friendly event slug",
                },
                attendeeLimit: {
                  type: "number",
                  description: "Maximum attendees",
                },
                tagline: { type: "string", description: "Event tagline" },
                startDate: {
                  type: "string",
                  description: "Start date (ISO string)",
                },
                endDate: {
                  type: "string",
                  description: "End date (ISO string)",
                },
                lumaEventId: { type: "string", description: "Luma event ID" },
                isDraft: { type: "boolean", description: "Is draft event" },
                isHackathon: {
                  type: "boolean",
                  description: "Is hackathon event",
                },
                highlightOnLandingPage: {
                  type: "boolean",
                  description: "Highlight on landing page",
                },
                fullAddress: { type: "string", description: "Full address" },
                shortLocation: {
                  type: "string",
                  description: "Short location name",
                },
                streetAddress: {
                  type: "string",
                  description: "Street address",
                },
              },
              required: [
                "name",
                "slug",
                "attendeeLimit",
                "tagline",
                "startDate",
                "endDate",
              ],
            },
          },
          required: ["event"],
        },
      },
      {
        name: "get_event_by_slug",
        description: "Get event by slug",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Event slug" },
          },
          required: ["slug"],
        },
      },
      {
        name: "update_event",
        description: "Update an existing event",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Event slug to update" },
            eventData: {
              type: "object",
              description: "Event data to update",
              additionalProperties: true,
            },
          },
          required: ["slug", "eventData"],
        },
      },
      // Profile tools
      {
        name: "find_profile_by_name",
        description: "Find profile by name",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Profile name" },
          },
          required: ["name"],
        },
      },
      {
        name: "create_profile",
        description: "Create a new profile with image",
        inputSchema: {
          type: "object",
          properties: {
            profile: {
              type: "object",
              properties: {
                name: { type: "string", description: "Profile name" },
                title: { type: "string", description: "Job title" },
                bio: { type: "string", description: "Biography" },
                linkedinHandle: {
                  type: "string",
                  description: "LinkedIn handle",
                },
                twitterHandle: {
                  type: "string",
                  description: "Twitter handle",
                },
                profileType: { type: "string", enum: ["member", "organizer"] },
              },
              required: ["name", "title", "bio", "profileType"],
            },
            imgPath: { type: "string", description: "Path to profile image" },
          },
          required: ["profile", "imgPath"],
        },
      },
      {
        name: "update_profile",
        description: "Update an existing profile",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Profile name" },
            profileData: {
              type: "object",
              description: "Profile data to update",
              additionalProperties: true,
            },
          },
          required: ["name", "profileData"],
        },
      },
      {
        name: "update_profile_by_id",
        description: "Update an existing profile by ID",
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Profile ID" },
            profileData: {
              type: "object",
              description: "Profile data to update",
              additionalProperties: true,
            },
          },
          required: ["id", "profileData"],
        },
      },
      {
        name: "set_profile_image",
        description: "Set a profile's photo, replacing any earlier one",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Profile name" },
            imgPath: { type: "string", description: "Path to new image" },
          },
          required: ["name", "imgPath"],
        },
      },
      // Talk tools
      {
        name: "create_talk",
        description: "Create a new talk with speakers",
        inputSchema: {
          type: "object",
          properties: {
            talk: {
              type: "object",
              properties: {
                title: { type: "string", description: "Talk title" },
                description: {
                  type: "string",
                  description: "Talk description",
                },
              },
              required: ["title", "description"],
            },
            speakerIds: {
              type: "array",
              items: { type: "string" },
              description: "Array of speaker profile IDs",
            },
          },
          required: ["talk", "speakerIds"],
        },
      },
      {
        name: "update_talk",
        description: "Update an existing talk",
        inputSchema: {
          type: "object",
          properties: {
            talkId: { type: "string", description: "Talk ID" },
            talkData: {
              type: "object",
              properties: {
                title: { type: "string", description: "Talk title" },
                description: {
                  type: "string",
                  description: "Talk description",
                },
              },
              additionalProperties: true,
              description: "Talk data to update",
            },
          },
          required: ["talkId", "talkData"],
        },
      },
      {
        name: "add_talk_to_event",
        description: "Add talk to event",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Event slug" },
            talkId: { type: "string", description: "Talk ID" },
          },
          required: ["slug", "talkId"],
        },
      },
      {
        name: "remove_talk_from_event",
        description: "Remove talk from event",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Event slug" },
            talkId: { type: "string", description: "Talk ID" },
          },
          required: ["slug", "talkId"],
        },
      },
      {
        name: "find_talks_by_speaker_name",
        description: "Find talks by speaker name",
        inputSchema: {
          type: "object",
          properties: {
            speakerName: { type: "string", description: "Speaker name" },
          },
          required: ["speakerName"],
        },
      },
      // Host tools
      {
        name: "create_host",
        description: "Create a new host with logos",
        inputSchema: {
          type: "object",
          properties: {
            host: {
              type: "object",
              properties: {
                name: { type: "string", description: "Host name" },
                about: { type: "string", description: "About host" },
              },
              required: ["name", "about"],
            },
            darkLogoFilePath: {
              type: "string",
              description: "Path to dark logo",
            },
            lightLogoFilePath: {
              type: "string",
              description: "Path to light logo",
            },
          },
          required: ["host", "darkLogoFilePath", "lightLogoFilePath"],
        },
      },
      {
        name: "add_host_to_event",
        description: "Add host to event",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Event slug" },
            hostName: { type: "string", description: "Host name" },
          },
          required: ["slug", "hostName"],
        },
      },
      // Image tools
      {
        name: "get_image_ids_for_urls",
        description: "Get image IDs for given URLs",
        inputSchema: {
          type: "object",
          properties: {
            imageUrls: {
              type: "array",
              items: { type: "string" },
              description: "Array of image URLs",
            },
          },
          required: ["imageUrls"],
        },
      },
      {
        name: "delete_event_images",
        description: "Delete event images by URLs",
        inputSchema: {
          type: "object",
          properties: {
            imageUrls: {
              type: "array",
              items: { type: "string" },
              description: "Array of image URLs to delete",
            },
          },
          required: ["imageUrls"],
        },
      },
      {
        name: "delete_orphaned_image",
        description:
          "Delete an orphaned image from storage (only if not in database)",
        inputSchema: {
          type: "object",
          properties: {
            imageUrl: {
              type: "string",
              description: "URL of the stored image to delete",
            },
          },
          required: ["imageUrl"],
        },
      },
      {
        name: "add_images_to_event",
        description: "Add images to event from directory",
        inputSchema: {
          type: "object",
          properties: {
            eventSlug: { type: "string", description: "Event slug" },
            imagesDir: {
              type: "string",
              description: "Images directory path (default: ./scripts/images)",
            },
          },
          required: ["eventSlug"],
        },
      },
      // Luma tools
      {
        name: "get_luma_event",
        description: "Fetch event data from Luma by event ID",
        inputSchema: {
          type: "object",
          properties: {
            eventId: {
              type: "string",
              description: "Luma event ID (e.g., evt-abc123)",
            },
          },
          required: ["eventId"],
        },
      },
      // Data quality
      {
        name: "get_completeness_report",
        description:
          "What each published event's record lacks (talks, people and their bios, photos and links, hosts with their logos and links, photos, recording, venue, topic), as core's completeness report computes it from the database. Read-only.",
        inputSchema: {
          type: "object",
          properties: {
            slug: {
              type: "string",
              description: "Only this event's report (its slug)",
            },
          },
          required: [],
        },
      },
      {
        name: "add_event_post",
        description:
          "Add a social post about an event to its page, approved. Reads X and Bluesky posts from public sources; a LinkedIn post needs authorName and text (and takes authorUrl). Adding a post that is already there changes nothing.",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "The event's slug" },
            url: {
              type: "string",
              description: "The post's URL on X, Bluesky or LinkedIn",
            },
            authorName: {
              type: "string",
              description: "LinkedIn only: the author's name",
            },
            authorUrl: {
              type: "string",
              description: "LinkedIn only: the author's profile URL",
            },
            text: {
              type: "string",
              description: "LinkedIn only: the post's text",
            },
          },
          required: ["slug", "url"],
        },
      },
      {
        name: "add_event_photos",
        description:
          "Add photos to an event's page, in the order given, after any it has. Each file is re-encoded (upright, at most 4096 px, JPEG, all metadata including location stripped), stored under a key named after its contents, and recorded with its alt text; adding a file that is already there changes nothing. Give one alt text per file describing the scene, never naming people from their faces. HEIC is not read: export JPEGs. dryRun checks everything and stores nothing.",
        inputSchema: {
          type: "object",
          properties: {
            slug: {
              type: "string",
              description: "The event's slug or short link",
            },
            files: {
              type: "array",
              items: { type: "string" },
              description: "Absolute paths of the photos, in display order",
            },
            alts: {
              type: "array",
              items: { type: "string" },
              description: "One alt text per file, in the same order",
            },
            dryRun: {
              type: "boolean",
              description:
                "Encode and check everything; store and write nothing",
            },
          },
          required: ["slug", "files", "alts"],
        },
      },
      {
        name: "replace_event_photo",
        description:
          "Replace one of an event's photos in its place on the page with a new file, encoded and stored as add_event_photos does. The old photo is named by its image id or its position on the page (from 1). In one transaction the new photo takes the old one's place and the old link and image row are deleted, only when nothing else uses that row; the old object stays in the bucket. Give alt text describing the scene, never naming people from their faces. dryRun checks everything and stores nothing.",
        inputSchema: {
          type: "object",
          properties: {
            slug: {
              type: "string",
              description: "The event's slug or short link",
            },
            photo: {
              type: "string",
              description:
                "The photo to replace: its image id, or its position on the page from 1",
            },
            file: {
              type: "string",
              description: "Absolute path of the new photo",
            },
            alt: { type: "string", description: "The new photo's alt text" },
            dryRun: {
              type: "boolean",
              description:
                "Encode and check everything; store and write nothing",
            },
          },
          required: ["slug", "photo", "file", "alt"],
        },
      },
      {
        name: "list_pending_posts",
        description:
          "Posts a search found about events, waiting for review: each with its event, URL, author, time and text. Pending posts never show on a page. Read-only.",
        inputSchema: {
          type: "object",
          properties: {
            slug: {
              type: "string",
              description: "Only this event's pending posts (its slug)",
            },
          },
          required: [],
        },
      },
      {
        name: "approve_post",
        description:
          "Approve a stored post (pending or hidden) so it shows on its event's page. Approve only a post that is clearly about that event.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "The post's URL" },
          },
          required: ["url"],
        },
      },
      {
        name: "hide_post",
        description:
          "Hide a stored post so it never shows; later searches leave it hidden.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "The post's URL" },
          },
          required: ["url"],
        },
      },
      // Promotion
      {
        name: "get_promo_drafts",
        description:
          "Drafts for promoting a published event, made from its record: the Luma description with speakers and bios, the Meetup cross-post with the settings to set by hand, and X, Bluesky, LinkedIn and Discord posts to announce it, on the day and after. Each fits its platform's limit. Drafts only: nothing is posted. Read-only.",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "The event's slug" },
            channels: {
              type: "array",
              items: { type: "string", enum: [...promoChannels] },
              description: "Only these drafts; all by default",
            },
            json: {
              type: "boolean",
              description:
                "Return JSON with each draft's length and limit instead of text",
            },
          },
          required: ["slug"],
        },
      },
      // Planning: ideas, wanted speakers, host prospects, notes (private)
      ...planToolDefinitions,
      draftReadinessTool,
      ...lumaToolDefinitions,
      // Administrator tools
      {
        name: "add_user_to_admins",
        description: "Add a user to administrators by user ID",
        inputSchema: {
          type: "object",
          properties: {
            userId: {
              type: "string",
              description: "User ID from neon_auth.users_sync table",
            },
          },
          required: ["userId"],
        },
      },
      {
        name: "remove_user_from_admins",
        description: "Remove a user from administrators by user ID",
        inputSchema: {
          type: "object",
          properties: {
            userId: {
              type: "string",
              description: "User ID to remove from administrators",
            },
          },
          required: ["userId"],
        },
      },
      {
        name: "list_admins",
        description: "List all administrators with user details",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ],
  };
});

// Tool execution handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name: toolName, arguments: args } = request.params;

  try {
    if (isLumaTool(toolName)) {
      const result = await lumaTool(toolName, args ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    if (isPlanTool(toolName)) {
      const result = await planTool(toolName, args ?? {});
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    switch (toolName) {
      // Event tools
      case "create_event": {
        const { event } = args as { event: any };
        const validatedEvent = CreateEventSchema.parse(event);
        const result = await createEvent(validatedEvent);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_event_by_slug": {
        const { slug } = args as { slug: string };
        const result = await getEventBySlug(slug);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "update_event": {
        const { slug, eventData } = args as { slug: string; eventData: any };
        const validatedEventData = UpdateEventSchema.parse(eventData);
        const result = await updateEvent(slug, validatedEventData);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Profile tools
      case "find_profile_by_name": {
        const { name } = args as { name: string };
        const result = await findProfileByName(name);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result || null, null, 2),
            },
          ],
        };
      }

      case "create_profile": {
        const { profile, imgPath } = args as { profile: any; imgPath: string };
        const validatedProfile = InsertProfileSchema.parse(profile);
        const result = await createProfile(validatedProfile, imgPath);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "update_profile": {
        const { name, profileData } = args as {
          name: string;
          profileData: any;
        };
        const result = await updateProfile(name, profileData);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "update_profile_by_id": {
        const { id, profileData } = args as { id: string; profileData: any };
        const result = await updateProfileById(id, profileData);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "set_profile_image": {
        const { name, imgPath } = args as { name: string; imgPath: string };
        const result = await setProfileImage(name, imgPath);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Talk tools
      case "create_talk": {
        const { talk, speakerIds } = args as {
          talk: any;
          speakerIds: string[];
        };
        const validatedTalk = InsertTalkSchema.parse(talk);
        const result = await createTalk(validatedTalk, speakerIds);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "update_talk": {
        const { talkId, talkData } = UpdateTalkSchema.parse(args);
        const result = await updateTalk(talkId, talkData);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "add_talk_to_event": {
        const { slug, talkId } = args as { slug: string; talkId: string };
        const result = await addTalkToEvent(slug, talkId);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "remove_talk_from_event": {
        const { slug, talkId } = args as { slug: string; talkId: string };
        const result = await removeTalkFromEvent(slug, talkId);
        return {
          content: [
            {
              type: "text",
              text: `Removed ${result.length} talk(s) from event`,
            },
          ],
        };
      }

      case "find_talks_by_speaker_name": {
        const { speakerName } = args as { speakerName: string };
        const result = await findTalksBySpeakerName(speakerName);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Host tools
      case "create_host": {
        const { host, darkLogoFilePath, lightLogoFilePath } = args as {
          host: any;
          darkLogoFilePath: string;
          lightLogoFilePath: string;
        };
        const validatedHost = InsertHostSchema.parse(host);
        const result = await createHost(
          validatedHost,
          darkLogoFilePath,
          lightLogoFilePath,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "add_host_to_event": {
        const { slug, hostName } = args as {
          slug: string;
          hostName: string;
        };
        const result = await addHostToEvent(slug, hostName);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Image tools
      case "get_image_ids_for_urls": {
        const { imageUrls } = args as { imageUrls: string[] };
        const result = await getImgIdsForUrls(imageUrls);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "delete_event_images": {
        const { imageUrls } = args as { imageUrls: string[] };
        const result = await deleteEventImages(imageUrls);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "delete_orphaned_image": {
        const { imageUrl } = args as { imageUrl: string };
        const result = await deleteOrphanedImage(imageUrl);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "add_images_to_event": {
        const { eventSlug, imagesDir } = args as {
          eventSlug: string;
          imagesDir?: string;
        };
        const result = await addImagesToEvent(eventSlug, imagesDir);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Luma tools
      case "get_luma_event": {
        const { eventId } = args as { eventId: string };
        const result = await getLumaEvent(eventId);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Administrator tools
      case "add_user_to_admins": {
        const { userId } = args as { userId: string };
        const result = await addUserToAdmins(userId);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "remove_user_from_admins": {
        const { userId } = args as { userId: string };
        const result = await removeUserFromAdmins(userId);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_completeness_report": {
        const { slug } = (args ?? {}) as { slug?: string };
        const result = await completenessReport(slug);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "list_pending_posts": {
        const { slug } = PendingPostsSchema.parse(args ?? {});
        const result = await listPendingPosts(slug);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "approve_post": {
        const result = await approvePost(PostUrlSchema.parse(args ?? {}).url);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "hide_post": {
        const result = await hidePost(PostUrlSchema.parse(args ?? {}).url);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "add_event_post": {
        const result = await addEventPost(AddEventPostSchema.parse(args ?? {}));
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "add_event_photos": {
        const result = await addEventPhotos(
          AddEventPhotosSchema.parse(args ?? {}),
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "replace_event_photo": {
        const result = await replaceEventPhoto(
          ReplaceEventPhotoSchema.parse(args ?? {}),
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "get_draft_readiness": {
        const result = await draftReadiness(args ?? {});
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "get_promo_drafts": {
        const text = await promoDrafts(GetPromoDraftsSchema.parse(args ?? {}));
        return { content: [{ type: "text", text }] };
      }

      case "list_admins": {
        const result = await listAdmins();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("AllThingsWeb Scripts MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
