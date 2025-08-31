import { replaceProfileImage } from "./functions";

const imgPath = "./scripts/profile.jpeg";
const name = "Sean Strong";

async function main() {
  try {
    await replaceProfileImage(name, imgPath);
    console.log("Profile image replaced successfully");
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
  }
}

main();
