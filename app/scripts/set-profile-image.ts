import { setProfileImage } from "./functions";

// Usage: bun scripts/set-profile-image.ts "<profile name>" <image path>
const [name, imgPath] = process.argv.slice(2);

async function main() {
  if (!name || !imgPath) {
    console.error(
      'Usage: bun scripts/set-profile-image.ts "<name>" <image path>',
    );
    process.exit(2);
  }
  await setProfileImage(name, imgPath);
  console.log(`Set the photo for ${name}`);
}

main().catch((error) => {
  console.error("Error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
