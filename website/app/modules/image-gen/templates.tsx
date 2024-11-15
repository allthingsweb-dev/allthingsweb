import { PocketBaseClient } from '~/domain/contracts/pocketbase';
import { toReadableDateTimeStr } from '../datetime';
import { ExpandedEvent, Speaker } from '~/domain/contracts/content';

declare module 'react' {
  interface HTMLAttributes<T> {
    tw?: string;
  }

  interface SVGProps<T> {
    tw?: string;
  }
}

function MapPinIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      tw="mr-2 h-8 w-8"
    >
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      tw="mr-2 h-8 w-8"
    >
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </svg>
  );
}

export function EventPreview({
  event,
  getPocketbaseUrlForImage,
}: {
  event: ExpandedEvent;
  getPocketbaseUrlForImage: PocketBaseClient['getPocketbaseUrlForImage'];
}) {
  return (
    <div
      tw="w-[1200px] h-[1200px] flex flex-col p-16 text-white"
      style={{
        background: 'linear-gradient(to bottom right, #3b0d60, #4b0082, #2d0031, #000000)',
      }}
    >
      <div tw="w-full flex items-start">
        {!!event.sponsors.length && event.sponsors.length < 3 && (
          <div tw="flex flex-col" style={{ gap: '1rem' }}>
            <div tw="text-2xl font-semibold">Sponsored by</div>
            <div tw="flex" style={{ gap: '2rem' }}>
              {event.sponsors.map((sponsor) => (
                <div key={sponsor.id} tw="flex flex-col items-center text-center">
                  <div tw="mb-2 w-40 h-40 bg-white p-2 rounded-lg overflow-hidden flex items-center justify-center">
                    <img
                      width={160}
                      height={160}
                      src={getPocketbaseUrlForImage(sponsor.squareLogoId, { width: 160, height: 160 })}
                      alt={sponsor.name}
                    />
                  </div>
                  <div tw="font-semibold text-xl">{sponsor.name}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {!!event.talks.length && (
          <div tw="flex flex-col" style={{ gap: '1rem', marginLeft: 'auto' }}>
            <div tw="text-2xl font-semibold">Speakers</div>
            <div tw="flex" style={{ gap: '2rem' }}>
              {event.talks.map(({ speaker }) => (
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
                  <div tw="text-sm opacity-75">{speaker.title}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div tw="flex flex-col items-center text-center" style={{ gap: '2rem', marginTop: '10rem' }}>
        <h1 tw="text-8xl font-bold leading-tight max-w-[1100px]">{event.name}</h1>
        <div tw="text-3xl flex justify-center" style={{ gap: '2rem' }}>
          <div tw="flex items-center">
            <CalendarIcon />
            {toReadableDateTimeStr(event.start, true)}
          </div>
          <div tw="flex items-center">
            <MapPinIcon />
            {event.shortLocation}
          </div>
        </div>
        {event.sponsors.length >= 3 && (
          <div tw="flex" style={{ gap: '2rem' }}>
            {event.sponsors.map((sponsor) => (
              <div key={sponsor.id} tw="flex flex-col items-center text-center">
                <div tw="mb-2 w-20 h-20 bg-white p-2 rounded-lg overflow-hidden flex items-center justify-center">
                  <img
                    width={80}
                    height={80}
                    src={getPocketbaseUrlForImage(sponsor.squareLogoId, { width: 80, height: 80 })}
                    alt={sponsor.name}
                  />
                </div>
                <div tw="font-semibold text-xl">{sponsor.name}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div tw="text-3xl flex justify-center" style={{ marginTop: 'auto' }}>
        Find us on allthingsweb.dev and lu.ma/allthingsweb!
      </div>
    </div>
  );
}

export function SpeakersPreview({
  speakers,
  getPocketbaseUrlForImage,
}: {
  speakers: Speaker[];
  getPocketbaseUrlForImage: PocketBaseClient['getPocketbaseUrlForImage'];
}) {
  const maxSpeakersToShow = 5 * 5;
  const visibleSpeakers = speakers.slice(0, maxSpeakersToShow);
  return (
    <div
      tw="w-[1200px] h-[1200px] flex flex-col p-16 text-white"
      style={{
        background: 'linear-gradient(to bottom right, #3b0d60, #4b0082, #2d0031, #000000)',
      }}
    >
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
  getPocketbaseUrlForImage: PocketBaseClient['getPocketbaseUrlForImage'];
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
