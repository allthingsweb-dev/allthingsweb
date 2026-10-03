import { join } from "node:path";
import { generateFiles, tokenFileSchema } from "../src/brand/generate";

const brandDir = join(import.meta.dir, "../src/brand");
const tokens = tokenFileSchema.parse(
  await Bun.file(join(brandDir, "all-things.tokens.json")).json(),
);

for (const [name, contents] of Object.entries(await generateFiles(tokens))) {
  await Bun.write(join(brandDir, name), contents);
}
console.log("Generated src/brand/theme.css and src/brand/tokens.ts");
