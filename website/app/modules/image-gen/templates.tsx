import { toReadableDateTimeStr } from "../datetime";
import { Image } from "../allthingsweb/images";
import { ExpandedEvent, ExpandedTalk } from "../allthingsweb/events";
import { Profile } from "../allthingsweb/profiles";

declare module "react" {
  interface HTMLAttributes<T> {
    tw?: string;
  }

  interface SVGProps<T> {
    tw?: string;
  }
}

const bgStyles = {
  background: "linear-gradient(to bottom right, #090215, #1e1924, #55505c)",
};

function EventPreviewTalks({ talks }: { talks: ExpandedTalk[] }) {
  return (
    <div tw="flex flex-wrap" style={{ gap: "1rem" }}>
      {talks.map((talk) => (
        <div key={talk.id} tw="flex items-center">
          <img
            src={talk.speakers[0].image.url}
            alt={`${talk.speakers[0].name} profile`}
            width={100}
            height={100}
            tw="rounded-full border-2 border-purple-400"
          />
          <div tw="flex flex-col ml-4">
            <div
              tw="w-[432px] flex text-3xl font-medium text-gray-100"
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {talk.speakers[0].name}
            </div>
            <div
              tw="w-[432px] flex text-xl text-purple-300"
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {talk.speakers[0].title}
            </div>
            <div
              tw="w-[432px] flex text-2xl text-white"
              style={{ wordBreak: "break-word" }}
            >
              {talk.title}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Social preview for the event details page
 * w1200 h630
 */
export function EventPreview({ event }: { event: ExpandedEvent }) {
  return (
    <div
      tw="w-[1200px] h-[630px] flex flex-col text-white p-8 overflow-hidden"
      style={bgStyles}
    >
      <div tw="h-full flex flex-col">
        <div tw="flex items-center mb-8" style={{ gap: "2rem" }}>
          <div tw="flex flex-col" style={{ gap: "1rem" }}>
            <span tw="text-6xl font-bold">{event.name}</span>
          </div>
        </div>
        <span tw="text-2xl text-gray-300 text-bold" style={{ gap: "8px" }}>
          {toReadableDateTimeStr(event.startDate, true)} at{" "}
          {event.shortLocation}
        </span>
        <span style={{ gap: "8px" }} tw="text-2xl text-purple-300 text-bold">
          lu.ma/allthingsweb
        </span>
        <div tw="flex-grow flex flex-col justify-between mt-12">
          <EventPreviewTalks talks={event.talks} />
          <div tw="flex flex-wrap" style={{ gap: "2rem" }}>
            {event.sponsors.map((sponsor, index) => (
              <div key={index} tw="flex items-center">
                <img
                  src={sponsor.squareLogoDark.url}
                  alt={`${sponsor.name} logo`}
                  width={60}
                  height={60}
                />
                <span tw="ml-2 text-4xl font-medium text-gray-200">
                  {sponsor.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function EventYouTubeThumbnailTwoTalks({ talks }: { talks: ExpandedTalk[] }) {
  return (
    <div tw="flex flex-wrap" style={{ gap: "3rem" }}>
      {talks.map((talk, index) => (
        <div key={index} tw="flex items-center w-[1200px]">
          <img
            src={talk.speakers[0].image.url}
            alt={`${talk.speakers[0].name} profile`}
            width={180}
            height={180}
            tw="rounded-full border-2 border-purple-400"
          />
          <div tw="flex flex-col ml-8">
            <div
              tw="w-[1000px] flex text-5xl font-medium text-gray-100"
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {talk.speakers[0].name}
            </div>
            <div
              tw="w-[1000px] flex text-5xl text-purple-300 mt-2"
              style={{ wordBreak: "break-word" }}
            >
              {talk.title}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EventYouTubeThumbnailFiveTalks({ talks }: { talks: ExpandedTalk[] }) {
  return (
    <div tw="flex flex-wrap" style={{ gap: "1rem" }}>
      {talks.map((talk, index) => (
        <div key={index} tw="flex items-center w-[1200px]">
          <img
            src={talk.speakers[0].image.url}
            alt={`${talk.speakers[0].name} profile`}
            width={100}
            height={100}
            tw="rounded-full border-2 border-purple-400"
          />
          <div tw="flex flex-col ml-4">
            <div
              tw="w-[1000px] flex text-3xl font-medium text-gray-100"
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {talk.speakers[0].name}
            </div>
            <div
              tw="w-[1000px] flex text-3xl text-purple-300"
              style={{ wordBreak: "break-word" }}
            >
              {talk.title}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function EventYouTubeThumbnail({ event }: { event: ExpandedEvent }) {
  const talksCount = event.talks.length;
  return (
    <div
      tw="w-[1280px] h-[720px] flex flex-col text-white p-8 pb-24 overflow-hidden"
      style={bgStyles}
    >
      <div tw="h-full flex flex-col">
        <div tw="flex text-7xl font-bold" style={{ marginBottom: "6rem" }}>
          {event.name}
        </div>
        {talksCount === 5 ? (
          <EventYouTubeThumbnailFiveTalks talks={event.talks} />
        ) : (
          <EventYouTubeThumbnailTwoTalks talks={event.talks} />
        )}
      </div>
    </div>
  );
}

/**
 * Social preview for the speakers page
 * w1200 h630
 */
export function SpeakersPreview({ speakers }: { speakers: Profile[] }) {
  const maxSpeakersToShow = 7 * 3;
  const visibleSpeakers = speakers.slice(0, maxSpeakersToShow);
  return (
    <div
      tw="w-[1200px] h-[630px] flex flex-col text-white p-4 overflow-hidden"
      style={bgStyles}
    >
      <div
        tw="w-full flex items-center justify-center flex-row flex-wrap"
        style={{ gap: "2rem" }}
      >
        {visibleSpeakers.map((speaker) => (
          <div key={speaker.id} tw="flex flex-col items-center text-center">
            <div tw="w-[120px] h-[120px] bg-gray-300 rounded-full mb-2 overflow-hidden flex items-center justify-center">
              <img
                src={speaker.image.url}
                alt={speaker.name}
                width={120}
                height={120}
                style={{ objectFit: "fill" }}
              />
            </div>
            <div tw="font-semibold text-xl">{speaker.name}</div>
          </div>
        ))}
      </div>
      <div tw="text-3xl flex justify-center" style={{ marginTop: "auto" }}>
        A random selection of our awesome speakers!
      </div>
    </div>
  );
}

/**
 * Social preview for the landing page
 * w1200 h630: 8 images - 4 per row (2 rows)
 */
export function LandingPagePreview({ images }: { images: Image[] }) {
  const maxImages = 8;
  const imagesToShow = images.slice(0, maxImages);
  return (
    <section tw="relative w-[1200px] h-[630px] overflow-hidden">
      <div tw="w-full flex flex-wrap absolute inset-0">
        {imagesToShow.map((image) => (
          <img
            key={image.url}
            src={image.url}
            alt="Past event image"
            tw="w-[300px] h-[315px]"
            width="300"
            height="315"
            style={{
              objectFit: "cover",
              objectPosition: "center",
            }}
          />
        ))}
      </div>
      <div
        tw="absolute inset-0 flex flex-col items-center text-center text-white"
        style={{
          paddingTop: "180px",
          background:
            "linear-gradient(to bottom, rgba(0,0,0,0.7), rgba(0,0,0,0.3))",
          zIndex: "20",
        }}
      >
        <h1
          tw="text-8xl font-light tracking-tight"
          style={{ marginBottom: "1rem" }}
        >
          All Things Web
        </h1>
        <p tw="max-w-4xl text-4xl">
          Discover exciting web development events in the Bay Area and San
          Francisco.
        </p>
      </div>
    </section>
  );
}
