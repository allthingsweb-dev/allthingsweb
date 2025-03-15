import { buildContainer } from "~/modules/container.server";
import { imagesTable } from "@lib/db/schema.server";

export async function getImgIdsForUrls() {
  let container = buildContainer();
  const db = container.cradle.db;
  const images = await db.select().from(imagesTable);
  const ids: string[] = [];
  const imageUrls = [
    "https://allthingsweb-dev.s3.us-west-2.amazonaws.com/events/2024-09-24-react-bay-area-at-cisco-meraki/4d224238-6b78-4d5e-9d84-4ca2d03b91b7.png",
  ];
  for (const image of images) {
    if (imageUrls.includes(image.url)) {
      ids.push(image.id);
    }
  }
  console.log(ids);
}

getImgIdsForUrls();
