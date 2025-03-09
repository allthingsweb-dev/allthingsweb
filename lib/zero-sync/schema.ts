import {
  table,
  string,
  number,
  boolean,
  relationships,
  createSchema,
} from "@rocicorp/zero";
import { definePermissions, ANYONE_CAN } from "@rocicorp/zero";

export const events = table("events")
  .columns({
    id: string(),
    name: string(),
    startDate: string().from("start_date"),
    endDate: string().from("end_date"),
    slug: string(),
    tagline: string(),
    attendeeLimit: number().from("attendee_limit"),
    streetAddress: string().from("street_address").optional(),
    shortLocation: string().from("short_location").optional(),
    fullAddress: string().from("full_address").optional(),
    lumaEventId: string().from("luma_event_id").optional(),
    isHackathon: boolean().from("is_hackathon"),
    isDraft: boolean().from("is_draft"),
    highlightOnLandingPage: boolean().from("highlight_on_landing_page"),
    previewImage: string().from("preview_image").optional(),
    recordingUrl: string().from("recording_url").optional(),
    createdAt: string().from("created_at"),
    updatedAt: string().from("updated_at"),
  })
  .primaryKey("id");

export const hacks = table("hacks")
  .columns({
    id: string(),
    eventId: string().from("event_id"),
    name: string(),
    description: string().optional(),
  })
  .primaryKey("id");

export const hackVotes = table("hackVotes")
  .from("hack_votes")
  .columns({
    id: string(),
    hackId: string().from("hack_id"),
    clerkUserId: string().from("clerk_user_id"),
  })
  .primaryKey("id");

export const hackUsers = table("hackUsers")
  .from("hack_users")
  .columns({
    hackId: string().from("hack_id"),
    clerkUserId: string().from("clerk_user_id"),
  })
  .primaryKey("hackId", "clerkUserId");

export const profiles = table("profiles")
  .columns({
    id: string(),
    name: string(),
    title: string(),
    bio: string(),
    profileType: string().from("profile_type"),
    twitterHandle: string().from("twitter_handle").optional(),
    blueskyHandle: string().from("bluesky_handle").optional(),
    linkedinHandle: string().from("linkedin_handle").optional(),
    image: string().optional(),
    createdAt: string().from("created_at"),
    updatedAt: string().from("updated_at"),
  })
  .primaryKey("id");

export const images = table("images")
  .columns({
    id: string(),
    url: string(),
    placeholder: string(),
    alt: string(),
    width: number(),
    height: number(),
    createdAt: string().from("created_at"),
    updatedAt: string().from("updated_at"),
  })
  .primaryKey("id");

export const talks = table("talks")
  .columns({
    id: string(),
    title: string(),
    description: string(),
    createdAt: string().from("created_at"),
    updatedAt: string().from("updated_at"),
  })
  .primaryKey("id");

export const talkSpeakers = table("talkSpeakers")
  .from("talk_speakers")
  .columns({
    talkId: string().from("talk_id"),
    speakerId: string().from("speaker_id"),
    createdAt: string().from("created_at"),
    updatedAt: string().from("updated_at"),
  })
  .primaryKey("talkId", "speakerId");

export const eventTalks = table("eventTalks")
  .from("event_talks")
  .columns({
    eventId: string().from("event_id"),
    talkId: string().from("talk_id"),
    createdAt: string().from("created_at"),
    updatedAt: string().from("updated_at"),
  })
  .primaryKey("eventId", "talkId");

export const eventImages = table("eventImages")
  .from("event_images")
  .columns({
    eventId: string().from("event_id"),
    imageId: string().from("image_id"),
    createdAt: string().from("created_at"),
    updatedAt: string().from("updated_at"),
  })
  .primaryKey("eventId", "imageId");

export const eventRelationships = relationships(events, ({ many }) => ({
  hacks: many({
    sourceField: ["id"],
    destSchema: hacks,
    destField: ["eventId"],
  }),
  talks: many({
    sourceField: ["id"],
    destSchema: eventTalks,
    destField: ["eventId"],
  }),
  images: many({
    sourceField: ["id"],
    destSchema: eventImages,
    destField: ["eventId"],
  }),
}));

export const hackRelationships = relationships(hacks, ({ one, many }) => ({
  event: one({
    sourceField: ["eventId"],
    destField: ["id"],
    destSchema: events,
  }),
  votes: many({
    sourceField: ["id"],
    destSchema: hackVotes,
    destField: ["hackId"],
  }),
  participants: many({
    sourceField: ["id"],
    destSchema: hackUsers,
    destField: ["hackId"],
  }),
}));

export const hackVoteRelationships = relationships(hackVotes, ({ one }) => ({
  hack: one({
    sourceField: ["hackId"],
    destField: ["id"],
    destSchema: hacks,
  }),
}));

export const hackUserRelationships = relationships(hackUsers, ({ one }) => ({
  hack: one({
    sourceField: ["hackId"],
    destField: ["id"],
    destSchema: hacks,
  }),
}));

export const profileRelationships = relationships(
  profiles,
  ({ one, many }) => ({
    profileImage: one({
      sourceField: ["image"],
      destField: ["id"],
      destSchema: images,
    }),
    talks: many({
      sourceField: ["id"],
      destSchema: talkSpeakers,
      destField: ["speakerId"],
    }),
  }),
);

export const imageRelationships = relationships(images, ({ many }) => ({
  profiles: many({
    sourceField: ["id"],
    destSchema: profiles,
    destField: ["image"],
  }),
  events: many({
    sourceField: ["id"],
    destSchema: eventImages,
    destField: ["imageId"],
  }),
}));

export const talkRelationships = relationships(talks, ({ many }) => ({
  speakers: many({
    sourceField: ["id"],
    destSchema: talkSpeakers,
    destField: ["talkId"],
  }),
  events: many({
    sourceField: ["id"],
    destSchema: eventTalks,
    destField: ["talkId"],
  }),
}));

export const talkSpeakerRelationships = relationships(
  talkSpeakers,
  ({ one }) => ({
    talk: one({
      sourceField: ["talkId"],
      destField: ["id"],
      destSchema: talks,
    }),
    speaker: one({
      sourceField: ["speakerId"],
      destField: ["id"],
      destSchema: profiles,
    }),
  }),
);

export const eventTalkRelationships = relationships(eventTalks, ({ one }) => ({
  event: one({
    sourceField: ["eventId"],
    destField: ["id"],
    destSchema: events,
  }),
  talk: one({
    sourceField: ["talkId"],
    destField: ["id"],
    destSchema: talks,
  }),
}));

export const eventImageRelationships = relationships(
  eventImages,
  ({ one }) => ({
    event: one({
      sourceField: ["eventId"],
      destField: ["id"],
      destSchema: events,
    }),
    image: one({
      sourceField: ["imageId"],
      destField: ["id"],
      destSchema: images,
    }),
  }),
);

export const schema = createSchema(1, {
  tables: [
    events,
    hacks,
    hackVotes,
    hackUsers,
    profiles,
    images,
    talks,
    talkSpeakers,
    eventTalks,
    eventImages,
  ],
  relationships: [
    eventRelationships,
    hackRelationships,
    hackVoteRelationships,
    hackUserRelationships,
    profileRelationships,
    imageRelationships,
    talkRelationships,
    talkSpeakerRelationships,
    eventTalkRelationships,
    eventImageRelationships,
  ],
});

export const permissions = definePermissions<{}, typeof schema>(schema, () => {
  return {
    // Event permissions
    events: {
      row: {
        // Anyone can read events
        select: ANYONE_CAN,
        // Only admins can create/update/delete events (we'll handle this on the API level)
        insert: [],
        update: { preMutation: [], postMutation: [] },
        delete: [],
      },
    },

    // Hack permissions
    hacks: {
      row: {
        // Anyone can read hacks
        select: ANYONE_CAN,
        // Only participants can create/update hacks (we'll handle this on the API level)
        insert: [],
        update: { preMutation: [], postMutation: [] },
        delete: [],
      },
    },

    // Hack votes permissions
    hackVotes: {
      row: {
        // Anyone can see votes
        select: ANYONE_CAN,
        // Can only vote if authenticated
        insert: [],
        // Can only update own votes
        update: {
          preMutation: [],
          postMutation: [],
        },
        // Can only delete own votes
        delete: [],
      },
    },

    // Hack users (participants) permissions
    hackUsers: {
      row: {
        // Anyone can see participants
        select: ANYONE_CAN,
        // Can only join if authenticated
        insert: [],
        // Can't update participation records
        update: { preMutation: [], postMutation: [] },
        // Can only leave a hack you're part of
        delete: [],
      },
    },

    // Profile permissions
    profiles: {
      row: {
        // Anyone can read profiles
        select: ANYONE_CAN,
        // Only admins can create/update/delete profiles (handle on API level)
        insert: [],
        update: { preMutation: [], postMutation: [] },
        delete: [],
      },
    },

    // Image permissions
    images: {
      row: {
        // Anyone can read images
        select: ANYONE_CAN,
        // Only admins can create/update/delete images (handle on API level)
        insert: [],
        update: { preMutation: [], postMutation: [] },
        delete: [],
      },
    },

    // Talk permissions
    talks: {
      row: {
        // Anyone can read talks
        select: ANYONE_CAN,
        // Only admins can create/update/delete talks (handle on API level)
        insert: [],
        update: { preMutation: [], postMutation: [] },
        delete: [],
      },
    },

    // Talk speakers permissions
    talkSpeakers: {
      row: {
        // Anyone can read talk speakers
        select: ANYONE_CAN,
        // Only admins can create/update/delete talk speakers (handle on API level)
        insert: [],
        update: { preMutation: [], postMutation: [] },
        delete: [],
      },
    },

    // Event talks permissions
    eventTalks: {
      row: {
        // Anyone can read event talks
        select: ANYONE_CAN,
        // Only admins can create/update/delete event talks (handle on API level)
        insert: [],
        update: { preMutation: [], postMutation: [] },
        delete: [],
      },
    },

    // Event images permissions
    eventImages: {
      row: {
        // Anyone can read event images
        select: ANYONE_CAN,
        // Only admins can create/update/delete event images (handle on API level)
        insert: [],
        update: { preMutation: [], postMutation: [] },
        delete: [],
      },
    },
  };
});
