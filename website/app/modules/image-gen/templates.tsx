import { toReadableDateTimeStr } from '../datetime';
import { createPocketbaseClient } from '../pocketbase/api.server';
import { ExpandedEvent, ExpandedTalk, Speaker } from '../pocketbase/pocketbase';

declare module 'react' {
  interface HTMLAttributes<T> {
    tw?: string;
  }

  interface SVGProps<T> {
    tw?: string;
  }
}

const bgStyles = {
  background: 'linear-gradient(to bottom right, #090215, #1e1924, #55505c)',
};

function EventPreviewTalks({
  talks,
  getPocketbaseUrlForImage,
}: {
  talks: ExpandedTalk[];
  getPocketbaseUrlForImage: ReturnType<typeof createPocketbaseClient>['getPocketbaseUrlForImage'];
}) {
  return (
    <div tw="flex flex-wrap" style={{ gap: '1rem' }}>
      {talks.map((talk) => (
        <div
          key={talk.id}
          tw="flex items-start rounded-xl p-4 border border-gray-300 border-opacity-20 shadow-lg w-[560px]"
          style={{
            backdropFilter: 'blur(8px)',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(209, 213, 219, 0.2)',
          }}
        >
          <img
            src={getPocketbaseUrlForImage(talk.speaker.profileImageId, { width: 100, height: 100 })}
            alt={`${talk.speaker.name} profile`}
            width={100}
            height={100}
            tw="rounded-full border-2 border-purple-400"
          />
          <div tw="flex flex-col ml-4">
            <div
              tw="w-[432px] flex text-3xl font-medium text-gray-100"
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {talk.speaker.name}
            </div>
            <div
              tw="w-[432px] flex text-xl text-purple-300"
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {talk.speaker.title}
            </div>
            <div tw="w-[432px] flex text-3xl text-gray-400 mt-2" style={{ wordBreak: 'break-word' }}>
              {talk.title}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function EventPreview({
  event,
  getPocketbaseUrlForImage,
  origin,
}: {
  event: ExpandedEvent;
  getPocketbaseUrlForImage: ReturnType<typeof createPocketbaseClient>['getPocketbaseUrlForImage'];
  origin: string;
}) {
  return (
    <div tw="w-[1200px] h-[1200px] flex flex-col text-white p-8 pb-24 overflow-hidden" style={bgStyles}>
      <div tw="h-full flex flex-col">
        <div tw="flex items-center mb-12" style={{ gap: '2rem' }}>
          <div tw="relative flex">
            <div
              tw="absolute bg-purple-400 rounded-full"
              style={{ filter: 'blur(4px)', top: 0, bottom: 0, right: 0, left: 0 }}
            ></div>
            <img
              src={`${origin}/logos/icon-circle-transparent-nobuffer.png`}
              alt="Event logo showing Golden Gate Bridge"
              width={140}
              height={140}
              tw="rounded-full w-[140px] h-[140px]"
            />
          </div>
          <div tw="flex text-7xl font-bold">{event.name}</div>
        </div>
        <div tw="flex text-4xl text-gray-300 text-bold">{toReadableDateTimeStr(event.start, true)}</div>
        <div tw="flex text-4xl text-gray-300 text-bold mb-4">{event.shortLocation}</div>
        <div tw="flex mb-8" style={{ gap: '12px' }}>
          <span tw="text-2xl text-purple-300 text-bold">allthingsweb.dev</span>
          <span tw="text-2xl text-purple-300 text-bold">lu.ma/allthingsweb</span>
        </div>
        <div tw="flex-grow flex flex-col justify-between">
          <div tw="flex flex-col">
            <div tw="flex flex-col text-4xl font-semibold mb-6 text-purple-300">Speakers & Talks</div>
            <EventPreviewTalks talks={event.talks} getPocketbaseUrlForImage={getPocketbaseUrlForImage} />
          </div>
          <div tw="flex flex-col">
            <div tw="flex flex-col">
              <h2 tw="text-4xl font-semibold mb-6 text-purple-300">Sponsors</h2>
              <div tw="flex flex-wrap" style={{ gap: '2rem' }}>
                {event.sponsors.map((sponsor, index) => (
                  <div
                    key={index}
                    tw="relative flex items-center rounded-xl p-4 shadow-lg"
                    style={{
                      backdropFilter: 'blur(8px)',
                      backgroundColor: 'rgba(255, 255, 255, 0.1)',
                      border: '1px solid rgba(209, 213, 219, 0.2)',
                    }}
                  >
                    <img
                      src={getPocketbaseUrlForImage(sponsor.squareLogoId, { width: 60, height: 60 })}
                      alt={`${sponsor.name} logo`}
                      width={60}
                      height={60}
                    />
                    <span tw="ml-4 text-5xl font-medium text-gray-200">{sponsor.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function EventYouTubeThumbnailTwoTalks({
  talks,
  getPocketbaseUrlForImage,
}: {
  talks: ExpandedTalk[];
  getPocketbaseUrlForImage: ReturnType<typeof createPocketbaseClient>['getPocketbaseUrlForImage'];
}) {
  return (
    <div tw="flex flex-wrap" style={{ gap: '3rem' }}>
      {talks.map((talk, index) => (
        <div key={index} tw="flex items-start w-[1200px]">
          <img
            src={getPocketbaseUrlForImage(talk.speaker.profileImageId, { width: 180, height: 180 })}
            alt={`${talk.speaker.name} profile`}
            width={180}
            height={180}
            tw="rounded-full border-2 border-purple-400"
          />
          <div tw="flex flex-col ml-8">
            <div
              tw="w-[1000px] flex text-5xl font-medium text-gray-100"
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {talk.speaker.name}
            </div>
            <div tw="w-[1000px] flex text-5xl text-purple-300 mt-2" style={{ wordBreak: 'break-word' }}>
              {talk.title}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EventYouTubeThumbnailFiveTalks({
  talks,
  getPocketbaseUrlForImage,
}: {
  talks: ExpandedTalk[];
  getPocketbaseUrlForImage: ReturnType<typeof createPocketbaseClient>['getPocketbaseUrlForImage'];
}) {
  return (
    <div tw="flex flex-wrap" style={{ gap: '1rem' }}>
      {talks.map((talk, index) => (
        <div key={index} tw="flex items-start w-[1200px]">
          <img
            src={getPocketbaseUrlForImage(talk.speaker.profileImageId, { width: 100, height: 100 })}
            alt={`${talk.speaker.name} profile`}
            width={100}
            height={100}
            tw="rounded-full border-2 border-purple-400"
          />
          <div tw="flex flex-col ml-4">
            <div
              tw="w-[1000px] flex text-3xl font-medium text-gray-100"
              style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {talk.speaker.name}
            </div>
            <div tw="w-[1000px] flex text-3xl text-purple-300" style={{ wordBreak: 'break-word' }}>
              {talk.title}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function EventYouTubeThumbnail({
  event,
  getPocketbaseUrlForImage,
  origin,
}: {
  event: ExpandedEvent;
  getPocketbaseUrlForImage: ReturnType<typeof createPocketbaseClient>['getPocketbaseUrlForImage'];
  origin: string;
}) {
  const talksCount = event.talks.length;
  return (
    <div tw="w-[1280px] h-[720px] flex flex-col text-white p-8 pb-24 overflow-hidden" style={bgStyles}>
      <div tw="h-full flex flex-col">
        <div tw="flex text-7xl font-bold" style={{ marginBottom: '6rem' }}>
          {event.name}
        </div>
        {talksCount === 5 ? (
          <EventYouTubeThumbnailFiveTalks talks={event.talks} getPocketbaseUrlForImage={getPocketbaseUrlForImage} />
        ) : (
          <EventYouTubeThumbnailTwoTalks talks={event.talks} getPocketbaseUrlForImage={getPocketbaseUrlForImage} />
        )}
      </div>
    </div>
  );
}

export function SpeakersPreview({
  speakers,
  getPocketbaseUrlForImage,
}: {
  speakers: Speaker[];
  getPocketbaseUrlForImage: ReturnType<typeof createPocketbaseClient>['getPocketbaseUrlForImage'];
}) {
  const maxSpeakersToShow = 5 * 5;
  const visibleSpeakers = speakers.slice(0, maxSpeakersToShow);
  return (
    <div tw="w-[1200px] h-[1200px] flex flex-col text-white p-16 pb-24 overflow-hidden" style={bgStyles}>
      <div tw="w-full flex items-start">
        <div tw="flex flex-col flex-wrap" style={{ gap: '1rem' }}>
          <div tw="text-2xl font-semibold">Speakers</div>
          <div tw="flex flex-row flex-wrap" style={{ gap: '2rem' }}>
            {visibleSpeakers.map((speaker) => (
              <div key={speaker.id} tw="flex flex-col items-center text-center">
                <div tw="w-40 h-40 bg-gray-300 rounded-full mb-2 overflow-hidden flex items-center justify-center">
                  <img
                    src={getPocketbaseUrlForImage(speaker.profileImageId, { width: 160, height: 160 })}
                    alt={speaker.name}
                    width={160}
                    height={160}
                    style={{ objectFit: 'fill' }}
                  />
                </div>
                <div tw="font-semibold text-xl">{speaker.name}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div tw="text-3xl flex justify-center" style={{ marginTop: 'auto' }}>
        Find us on allthingsweb.dev and lu.ma/allthingsweb!
      </div>
    </div>
  );
}

export function LandingPagePreview({
  photoIds,
  getPocketbaseUrlForImage,
}: {
  photoIds: string[];
  getPocketbaseUrlForImage: ReturnType<typeof createPocketbaseClient>['getPocketbaseUrlForImage'];
}) {
  return (
    <section tw="relative w-[1200px] h-[1200px] overflow-hidden">
      <div tw="w-full flex flex-wrap absolute inset-0">
        {photoIds.map((photoId) => (
          <img
            key={photoId}
            src={getPocketbaseUrlForImage(photoId, { width: 300, height: 300 })}
            alt="Past event image"
            tw="w-[300px] h-[300px]"
            width="300"
            height="300"
            style={{
              objectFit: 'cover',
              objectPosition: 'center',
            }}
          />
        ))}
      </div>
      <div
        tw="absolute inset-0 flex flex-col items-center text-center text-white"
        style={{
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.7), rgba(0,0,0,0.3))',
          paddingTop: '480px',
          zIndex: '20',
        }}
      >
        <h1 tw="text-8xl font-light tracking-tight" style={{ marginBottom: '1rem' }}>
          All Things Web
        </h1>
        <p tw="max-w-4xl text-4xl">Discover exciting web development events in the Bay Area and San Francisco.</p>
      </div>
    </section>
  );
}
