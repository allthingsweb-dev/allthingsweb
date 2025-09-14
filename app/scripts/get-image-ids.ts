import { getImgIdsForUrls } from "./functions";

const imageUrls = [
  "https://allthingsweb-dev.s3.us-west-2.amazonaws.com/events/2024-09-24-react-bay-area-at-cisco-meraki/4d224238-6b78-4d5e-9d84-4ca2d03b91b7.png",
];

async function main() {
  const ids = await getImgIdsForUrls(imageUrls);
  console.log(ids);
}

main();
