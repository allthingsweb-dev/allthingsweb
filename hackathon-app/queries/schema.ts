import { table, string, relationships, createSchema } from '@rocicorp/zero';
import { definePermissions, ANYONE_CAN } from '@rocicorp/zero';

export const events = table("events")
  .columns({
    id: string(),
    name: string(),
    startDate: string().from("start_date"),
    slug: string(),
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

export const eventRelationships = relationships(events, ({ many }) => ({
  hacks: many({
    sourceField: ["id"],
    destSchema: hacks,
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

export const schema = createSchema(
  1,
  {
    tables: [events, hacks, hackVotes, hackUsers],
    relationships: [
      eventRelationships,
      hackRelationships,
      hackVoteRelationships,
      hackUserRelationships,
    ],
  }
); 

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
  };
}); 
