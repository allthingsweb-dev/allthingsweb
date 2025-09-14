import { removeUserFromAdmins } from "./functions";

// Replace with the actual user ID to remove from administrators
const userId = "your-user-id-here";

async function main() {
  try {
    const result = await removeUserFromAdmins(userId);
    console.log("✅ User removed from administrators successfully!");
    console.log("Removed admin record:", result);
  } catch (error) {
    console.error(
      "❌ Error removing user from admins:",
      error instanceof Error ? error.message : error,
    );
  }
}

main();
