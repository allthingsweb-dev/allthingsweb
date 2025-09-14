import { listAdmins } from "./functions";

async function main() {
  try {
    const admins = await listAdmins();
    console.log(`📋 Found ${admins.length} administrator(s):`);

    if (admins.length === 0) {
      console.log("No administrators found.");
      return;
    }

    admins.forEach((admin, index) => {
      console.log(`\n${index + 1}. ${admin.userName || "Unknown Name"}`);
      console.log(`   User ID: ${admin.userId}`);
      console.log(`   Email: ${admin.userEmail || "No email"}`);
      console.log(`   Added: ${admin.createdAt?.toISOString()}`);
    });
  } catch (error) {
    console.error(
      "❌ Error listing admins:",
      error instanceof Error ? error.message : error,
    );
  }
}

main();
