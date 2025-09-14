import { InsertProfile } from "../src/lib/schema";
import { createProfile } from "./functions";

const imgPath = "./scripts/images/profile.jpg";
const profile: InsertProfile = {
  name: "Lee Robinson",
  title: "VP of Developer Experience at Vercel",
  bio: "Lee Robinson is the VP of Developer Experience at Vercel. He's a developer, optimist, and community builder. Lee is passionate about teaching about React, Next.js, and the web.",
  linkedinHandle: "leeerob",
  twitterHandle: "leerob",
  profileType: "member",
};

async function main() {
  const createdProfile = await createProfile(profile, imgPath);
  if (!createdProfile) {
    console.error("Failed to create profile");
    return;
  }

  console.log(createdProfile.id);
}

main();
