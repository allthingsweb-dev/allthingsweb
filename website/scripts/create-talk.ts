import { InsertTalk } from "@lib/db/schema.server";
import { createTalk } from "./functions";

const talk = {
  title: "Performance optimizing agent for Next.js",
  description:
    "In this talk, Lee Robinson will be talking about the performance optimizing agent for Next.js and evals for better code generation.",
} satisfies InsertTalk;

const speakerIds = ["8830e0cb-0989-4814-b9f5-0fbcb212fdf4"];

async function main() {
  const { talk: createdTalk, speakers } = await createTalk(talk, speakerIds);
  console.log(createdTalk);
  console.log(speakers);
}

main();
