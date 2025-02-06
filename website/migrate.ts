import { mainConfig } from '~/config.server';
import { db } from '~/modules/db/client.server';
import { profilesTable, imagesTable, talksTable, sponsorsTable, eventsTable } from '~/modules/db/schema.server';
import { createPocketbaseClient } from '~/modules/pocketbase/api.server';
import { randomUUID } from 'node:crypto';
import { write, S3Client } from 'bun';
import { eq } from 'drizzle-orm';

const imgOrigin = 'https://allthingsweb-cms.fly.dev/api/files/';
// allthingsweb-dev;

const client = createPocketbaseClient({ mainConfig });
client.authenticateAdmin();

const s3client = new S3Client({
  accessKeyId: mainConfig.s3.accessKeyId,
  secretAccessKey: mainConfig.s3.secretAccessKey,
  //bucket: mainConfig.s3.bucket,
  endpoint: mainConfig.s3.url,
  // acl: 'public-read',
  // sessionToken: "..."
  // acl: "public-read",
  // endpoint: "https://s3.us-east-1.amazonaws.com",
});

const talks = await client.getTalks();
const sponsors = await client.getSponsors();
const events = await client.getEvents();

for (const event of events) {
  const eventTalks = talks.filter((t) => event.talks.includes(t.id));
  const eventSponsors = sponsors.filter((s) => event.sponsors.includes(s.id));

  const neonTalks = await db.select().from(talksTable);
  const neonSponsors = await db.select().from(sponsorsTable);

  const talkIds: string[] = [];
  for (const talk of neonTalks) {
    const inEvent = eventTalks.find((t) => t.title === talk.title);
    if (inEvent) {
      talkIds.push(talk.id);
    }
  }

  const sponsorIds: string[] = [];
  for (const sponsor of neonSponsors) {
    const inEvent = eventSponsors.find((s) => s.name === sponsor.name);
    if (inEvent) {
      sponsorIds.push(sponsor.id);
    }
  }

  console.log('talkIds:', talkIds);
  console.log('sponsorIds:', sponsorIds);

  const previewImg = event.previewImage;
  let previewImgId = null;
  if (previewImg) {
    previewImgId = randomUUID();
    const imgUrl = `${imgOrigin}events/${event.id}/${previewImg}`;
    console.log('imgUrl:', imgUrl);
    const eventPreviewImgKey = `events/${event.slug}/preview-${previewImgId}.png`;

    // Bun.s3 reads environment variables for credentials
    // file() returns a lazy reference to a file on S3
    const metadata = s3client.file(eventPreviewImgKey);

    // // Upload to S3
    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok || !imgRes.body) {
      throw new Error(`Failed to fetch image: ${imgUrl}`);
    }
    const imgBuffer = await imgRes.arrayBuffer();
    await write(metadata, imgBuffer);
    console.log(`Uploaded ${eventPreviewImgKey}`);

    await db.insert(imagesTable).values({
      id: previewImgId,
      url: mainConfig.s3.url + '/' + eventPreviewImgKey,
      alt: `${event.name} event preview`,
    });
  }

  const photoIds: string[] = [];
  for (const photo of event.photos) {
    const imgId = randomUUID();
    const imgUrl = `${imgOrigin}events/${event.id}/${photo}`;
    console.log('imgUrl:', imgUrl);
    const imgKey = `events/${event.slug}/${imgId}.png`;

    // Bun.s3 reads environment variables for credentials
    // file() returns a lazy reference to a file on S3
    const metadata = s3client.file(imgKey);

    // // Upload to S3
    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok || !imgRes.body) {
      throw new Error(`Failed to fetch image: ${imgUrl}`);
    }
    const imgBuffer = await imgRes.arrayBuffer();
    await write(metadata, imgBuffer);
    console.log(`Uploaded ${imgKey}`);

    await db.insert(imagesTable).values({
      id: imgId,
      url: mainConfig.s3.url + '/' + imgKey,
      alt: `${event.name} event photo`,
    });

    photoIds.push(imgId);
  }

  //   attendeeLimit: 150,
  // end: "2024-12-04 04:00:00.000Z",
  // fullAddress: "444 De Haro St #218, San Francisco, CA 94107, USA",
  // highlightOnLandingPage: true,
  // isDraft: false,
  // isHackathon: false,
  // lumaEventId: "evt-deGtRGSvYsWMqAc",
  // name: "All Things Web at Convex",
  // photos: [ "img_3240_vB2R3kRHhK.png", "img_3241_C3ibjEryiZ.png",
  //   "img_3244_ljRlWnkNu9.png", "img_3245_gWCTZnrAXu.png",
  //   "img_3246_BpcfcWtbut.png", "img_3249_Al7uogZU8Z.png"
  // ],
  // previewImage: "",
  // recordingUrl: "https://youtu.be/QfDQqDjKmWw",
  // shortLocation: "Convex HQ",
  // slug: "2024-12-03-all-things-web-at-convex",
  // sponsors: [ "e0bmeimzi0zxix5", "mg8wlmafh0u2c8y" ],
  // start: "2024-12-04 00:00:00.000Z",
  // streetAddress: "444 De Haro St #218",
  // tagline: "Join us for a combined React & React Native meetup at Convex.",
  // talks: [ "t5h3bc8ftdqro5i", "1jvp96a0mv2ki2p" ],
  await db.insert(eventsTable).values({
    name: event.name,
    startDate: new Date(event.start),
    endDate: new Date(event.end),
    slug: event.slug,
    tagline: event.tagline,
    attendeeLimit: event.attendeeLimit,
    streetAddress: event.streetAddress,
    shortLocation: event.shortLocation,
    fullAddress: event.fullAddress,
    lumaEventId: event.lumaEventId || null,
    isHackathon: event.isHackathon,
    isDraft: event.isDraft,
    highlightOnLandingPage: event.highlightOnLandingPage,
    previewImage: previewImgId,
    recordingUrl: event.recordingUrl || null,
    talks: talkIds,
    sponsors: sponsorIds,
  });
}
