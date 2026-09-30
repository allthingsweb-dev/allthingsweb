#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  createEvent,
  getEventBySlug,
  updateEvent,
  findProfileByName,
  createProfile,
  updateProfile,
  updateProfileById,
  replaceProfileImage,
  createTalk,
  updateTalk,
  addTalkToEvent,
  removeTalkFromEvent,
  findTalksBySpeakerName,
  createSponsor,
  addSponsorToEvent,
  getImgIdsForUrls,
  deleteEventImages,
  deleteOrphanedImage,
  addImagesToEvent,
  addUserToAdmins,
  removeUserFromAdmins,
  listAdmins,
  getLumaEvent,
  createAward,
  listAwards,
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

const InsertSponsorSchema = z.object({
  name: z.string(),
  about: z.string(), // Required in schema
});

const CreateAwardSchema = z.object({
  eventId: z.string(),
  name: z.string(),
});

const ListAwardsSchema = z.object({
  eventId: z.string(),
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
        name: "replace_profile_image",
        description: "Replace profile image",
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
      // Sponsor tools
      {
        name: "create_sponsor",
        description: "Create a new sponsor with logos",
        inputSchema: {
          type: "object",
          properties: {
            sponsor: {
              type: "object",
              properties: {
                name: { type: "string", description: "Sponsor name" },
                about: { type: "string", description: "About sponsor" },
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
          required: ["sponsor", "darkLogoFilePath", "lightLogoFilePath"],
        },
      },
      {
        name: "add_sponsor_to_event",
        description: "Add sponsor to event",
        inputSchema: {
          type: "object",
          properties: {
            slug: { type: "string", description: "Event slug" },
            sponsorName: { type: "string", description: "Sponsor name" },
          },
          required: ["slug", "sponsorName"],
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
          "Delete an orphaned image from S3 (only if not in database)",
        inputSchema: {
          type: "object",
          properties: {
            s3Url: {
              type: "string",
              description: "S3 URL of the image to delete",
            },
          },
          required: ["s3Url"],
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
      // Award tools
      {
        name: "create_award",
        description: "Create a new award for a hackathon event",
        inputSchema: {
          type: "object",
          properties: {
            eventId: {
              type: "string",
              description: "Event ID for the hackathon",
            },
            name: {
              type: "string",
              description:
                "Award name (e.g., 'Best Innovation', 'People's Choice')",
            },
          },
          required: ["eventId", "name"],
        },
      },
      {
        name: "list_awards",
        description: "List all awards for a hackathon event",
        inputSchema: {
          type: "object",
          properties: {
            eventId: {
              type: "string",
              description: "Event ID for the hackathon",
            },
          },
          required: ["eventId"],
        },
      },
    ],
  };
});

// Tool execution handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
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

      case "replace_profile_image": {
        const { name, imgPath } = args as { name: string; imgPath: string };
        const result = await replaceProfileImage(name, imgPath);
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

      // Sponsor tools
      case "create_sponsor": {
        const { sponsor, darkLogoFilePath, lightLogoFilePath } = args as {
          sponsor: any;
          darkLogoFilePath: string;
          lightLogoFilePath: string;
        };
        const validatedSponsor = InsertSponsorSchema.parse(sponsor);
        const result = await createSponsor(
          validatedSponsor,
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

      case "add_sponsor_to_event": {
        const { slug, sponsorName } = args as {
          slug: string;
          sponsorName: string;
        };
        const result = await addSponsorToEvent(slug, sponsorName);
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
        const { s3Url } = args as { s3Url: string };
        const result = await deleteOrphanedImage(s3Url);
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

      case "create_award": {
        const { eventId, name } = args as { eventId: string; name: string };
        const result = await createAward({ eventId, name });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "list_awards": {
        const { eventId } = args as { eventId: string };
        const result = await listAwards(eventId);
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
        throw new Error(`Unknown tool: ${name}`);
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
