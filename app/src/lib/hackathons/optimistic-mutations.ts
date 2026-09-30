import { createOptimisticAction } from "@tanstack/react-db";
import {
  hacksCollection,
  hackUsersCollection,
} from "@/lib/hackathons/collections";

export interface CreateTeamData {
  hackData: {
    id: string;
    event_id: string;
    team_name: string;
    project_name: string | null;
    project_description: string | null;
    project_link: string | null;
    team_image: string | null;
    created_at: string;
    updated_at: string;
  };
  userIds: string[];
}

// Create team action using TanStack DB transaction
export const createTeamAction = createOptimisticAction<CreateTeamData>({
  onMutate: ({ hackData, userIds }) => {
    // Insert the hack optimistically (already in snake_case format)
    hacksCollection.insert(hackData);
    console.log("✅ createTeamAction.onMutate - Hack inserted optimistically", {
      hackData,
    });

    // Insert all hack users optimistically
    for (const userId of userIds) {
      const hackUserData = {
        hack_id: hackData.id,
        user_id: userId,
        created_at: hackData.created_at,
        updated_at: hackData.updated_at,
      };

      hackUsersCollection.insert(hackUserData);
      console.log(
        "✅ createTeamAction.onMutate - Hack user inserted optimistically",
        {
          hackUserData,
          compositeKey: `${hackData.id}-${userId}`,
        },
      );
    }
  },

  mutationFn: async (teamData, { transaction }) => {
    console.log(
      "🚀 createTeamAction.mutationFn - Starting server persistence",
      {
        teamData,
        transactionId: transaction.id,
        mutationCount: transaction.mutations.length,
      },
    );

    // Send the team creation request to the new teams endpoint
    const response = await fetch("/api/v1/teams", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(teamData),
    });

    console.log("📥 createTeamAction.mutationFn - API response", {
      status: response.status,
      ok: response.ok,
      statusText: response.statusText,
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ createTeamAction.mutationFn - API error", {
        status: response.status,
        statusText: response.statusText,
        errorText,
      });
      throw new Error(
        `Failed to create team: ${response.status} - ${errorText}`,
      );
    }

    const result = await response.json();
    console.log("✅ createTeamAction.mutationFn - Success", {
      result,
      txid: result.txid,
    });

    // Wait for the transaction to sync back from Electric
    // Get all unique collections from the transaction
    const collections = new Set(
      transaction.mutations.map((mutation) => mutation.collection),
    );
    const promises = [...collections].map((collection) =>
      collection.utils.awaitTxId(result.txid),
    );

    console.log("🔄 createTeamAction.mutationFn - Waiting for sync", {
      txid: result.txid,
      collectionsCount: collections.size,
    });

    await Promise.all(promises);

    console.log("✅ createTeamAction.mutationFn - Sync completed", {
      txid: result.txid,
    });

    return result;
  },
});
