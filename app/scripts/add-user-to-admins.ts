import { addUserToAdmins } from "./functions";

// Replace with the actual user ID from the neon_auth.users_sync table
const userId = "your-user-id-here";

async function main() {
  try {
    const result = await addUserToAdmins(userId);
    console.log("✅ User added to administrators successfully!");
    console.log("Admin record:", result.admin);
    console.log("User info:", {
      id: result.user.id,
      name: result.user.name,
      email: result.user.email,
    });
  } catch (error) {
    console.error(
      "❌ Error adding user to admins:",
      error instanceof Error ? error.message : error,
    );
  }
}

main();
