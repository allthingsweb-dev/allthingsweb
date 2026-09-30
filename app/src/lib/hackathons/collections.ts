import { createCollection } from "@tanstack/react-db";
import { electricCollectionOptions } from "@tanstack/electric-db-collection";
import { z } from "zod";

const hackSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  team_name: z.string(),
  project_name: z.string().nullable(),
  project_description: z.string().nullable(),
  team_image: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const hackVoteSchema = z.object({
  hack_id: z.string(),
  award_id: z.string(),
  user_id: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const awardSchema = z.object({
  id: z.string(),
  event_id: z.string(),
  name: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const hackUserSchema = z.object({
  hack_id: z.string(),
  user_id: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
});

const imageSchema = z.object({
  id: z.string(),
  url: z.string(),
  alt: z.string(),
  width: z.number(),
  height: z.number(),
});

const getShapeUrl = () => {
  // Safe to assume window is available in client components wrapped with ClientOnly
  return `${window.location.origin}/api/v1/shapes`;
};

export const hackImagesCollection = createCollection(
  electricCollectionOptions({
    id: "images",
    shapeOptions: {
      url: `${getShapeUrl()}/hack-images`,
      params: {
        table: "images",
        columns: ["id", "url", "alt", "width", "height"],
      },
    },
    getKey: (item) => item.id,
    schema: imageSchema,
  }),
);

export const hacksCollection = createCollection(
  electricCollectionOptions({
    id: "hacks",
    shapeOptions: {
      url: `${getShapeUrl()}/hacks`,
      params: {
        table: "hacks",
      },
    },
    getKey: (item) => item.id,
    schema: hackSchema,
    onInsert: async ({ transaction }) => {
      console.log("🚀 hacksCollection.onInsert - Starting hack creation", {
        transactionId: transaction.id,
        mutationCount: transaction.mutations.length,
        mutation: transaction.mutations[0],
      });

      const {
        created_at: _createdAt,
        updated_at: _updatedAt,
        ...modified
      } = transaction.mutations[0].modified;

      console.log("📤 hacksCollection.onInsert - Sending hack to API", {
        payload: modified,
      });

      // Send the new hack to the API
      const response = await fetch("/api/v1/hacks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(modified),
      });

      console.log("📥 hacksCollection.onInsert - API response", {
        status: response.status,
        ok: response.ok,
        statusText: response.statusText,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ hacksCollection.onInsert - API error", {
          status: response.status,
          statusText: response.statusText,
          errorText,
        });
        throw new Error(
          `Failed to create hack: ${response.status} - ${errorText}`,
        );
      }

      const result = await response.json();
      console.log("✅ hacksCollection.onInsert - Success", {
        result,
        txid: result.txid,
      });

      // Return txid for TanStack DB to handle awaitTxId automatically
      return { txid: result.txid };
    },
    onUpdate: async ({ transaction }) => {
      const txids = await Promise.all(
        transaction.mutations.map(async (mutation) => {
          const { original, changes } = mutation;
          if (!("id" in original)) {
            throw new Error(`Original hack not found for update`);
          }

          const response = await fetch(`/api/v1/hacks/${original.id}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(changes),
          });

          if (!response.ok) {
            throw new Error(`Failed to update hack: ${response.status}`);
          }

          const result = await response.json();
          return result.txid;
        }),
      );

      // Return txids for TanStack DB to handle awaitTxId automatically
      return { txid: txids };
    },
    onDelete: async ({ transaction }) => {
      const txids = await Promise.all(
        transaction.mutations.map(async (mutation) => {
          const { original } = mutation;
          if (!("id" in original)) {
            throw new Error(`Original hack not found for delete`);
          }

          const response = await fetch(`/api/v1/hacks/${original.id}`, {
            method: "DELETE",
          });

          if (!response.ok) {
            throw new Error(`Failed to delete hack: ${response.status}`);
          }

          const result = await response.json();
          return result.txid;
        }),
      );

      // Return txids for TanStack DB to handle awaitTxId automatically
      return { txid: txids };
    },
  }),
);

// Hack Votes Collection
export const hackVotesCollection = createCollection(
  electricCollectionOptions({
    id: "hack_votes",
    shapeOptions: {
      url: `${getShapeUrl()}/hack-votes`,
      params: {
        table: "hack_votes",
      },
    },
    getKey: (item) => `${item.hack_id}-${item.award_id}-${item.user_id}`, // Composite key for primary key
    schema: hackVoteSchema,
    onInsert: async ({ transaction }) => {
      const {
        created_at: _createdAt,
        updated_at: _updatedAt,
        ...modified
      } = transaction.mutations[0].modified;

      // Send the new vote to the API
      const response = await fetch("/api/v1/hack-votes", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(modified),
      });

      if (!response.ok) {
        throw new Error(`Failed to create vote: ${response.status}`);
      }

      const result = await response.json();

      // Return txid for TanStack DB to handle awaitTxId automatically
      return { txid: result.txid };
    },
    onDelete: async ({ transaction }) => {
      const txids = await Promise.all(
        transaction.mutations.map(async (mutation) => {
          const { original } = mutation;
          if (
            !(
              "hackId" in original &&
              "awardId" in original &&
              "userId" in original
            )
          ) {
            throw new Error(`Original vote not found for delete`);
          }

          const response = await fetch("/api/v1/hack-votes", {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              hackId: original.hackId,
              awardId: original.awardId,
              userId: original.userId,
            }),
          });

          if (!response.ok) {
            throw new Error(`Failed to delete vote: ${response.status}`);
          }

          const result = await response.json();
          return result.txid;
        }),
      );

      // Return txids for TanStack DB to handle awaitTxId automatically
      return { txid: txids };
    },
  }),
);

// Awards Collection
export const awardsCollection = createCollection(
  electricCollectionOptions({
    id: "awards",
    shapeOptions: {
      url: `${getShapeUrl()}/awards`,
      params: {
        table: "awards",
      },
    },
    getKey: (item) => item.id,
    schema: awardSchema,
  }),
);

// Hack Users Collection
export const hackUsersCollection = createCollection(
  electricCollectionOptions({
    id: "hack_users",
    shapeOptions: {
      url: `${getShapeUrl()}/hack-users`,
      params: {
        table: "hack_users",
      },
    },
    getKey: (item) => `${item.hack_id}-${item.user_id}`, // Composite key for junction table
    schema: hackUserSchema,
    onInsert: async ({ transaction }) => {
      console.log(
        "🚀 hackUsersCollection.onInsert - Starting hack user creation",
        {
          transactionId: transaction.id,
          mutationCount: transaction.mutations.length,
          mutation: transaction.mutations[0],
        },
      );

      const {
        created_at: _createdAt,
        updated_at: _updatedAt,
        ...modified
      } = transaction.mutations[0].modified;

      console.log(
        "📤 hackUsersCollection.onInsert - Sending hack user to API",
        {
          payload: modified,
          hackId: modified.hack_id,
          userId: modified.user_id,
        },
      );

      // Send the new hack user to the API
      const response = await fetch("/api/v1/hack-users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(modified),
      });

      console.log("📥 hackUsersCollection.onInsert - API response", {
        status: response.status,
        ok: response.ok,
        statusText: response.statusText,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("❌ hackUsersCollection.onInsert - API error", {
          status: response.status,
          statusText: response.statusText,
          errorText,
        });
        throw new Error(
          `Failed to add user to hack: ${response.status} - ${errorText}`,
        );
      }

      const result = await response.json();
      console.log("✅ hackUsersCollection.onInsert - Success", {
        result,
        txid: result.txid,
      });

      // Return txid for TanStack DB to handle awaitTxId automatically
      return { txid: result.txid };
    },
    onDelete: async ({ transaction }) => {
      const txids = await Promise.all(
        transaction.mutations.map(async (mutation) => {
          const { original } = mutation;
          if (!("hackId" in original && "userId" in original)) {
            throw new Error(`Original hack user not found for delete`);
          }

          const response = await fetch("/api/v1/hack-users", {
            method: "DELETE",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              hackId: original.hackId,
              userId: original.userId,
            }),
          });

          if (!response.ok) {
            throw new Error(
              `Failed to remove user from hack: ${response.status}`,
            );
          }

          const result = await response.json();
          return result.txid;
        }),
      );

      // Return txids for TanStack DB to handle awaitTxId automatically
      return { txid: txids };
    },
  }),
);
