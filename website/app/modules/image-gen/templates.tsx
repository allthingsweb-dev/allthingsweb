import { toReadableDateTimeStr } from '../datetime';
import { ExpandedEvent, Speaker } from '../pocketbase/pocketbase';

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

export function EventPreview({ event }: { event: ExpandedEvent; serverOrigin: string }) {
  return (
    <div
      tw="w-[1200px] h-[1200px] bg-gradient-to-br flex flex-col p-16 text-white"
      style={{
        background: 'linear-gradient(to bottom right, #3b0d60, #4b0082, #2d0031, #000000)',
      }}
    >
      <div tw="w-full flex items-start">
        {!!event.sponsors.length && (
          <div tw="flex flex-col" style={{ gap: '1rem' }}>
            <div tw="text-2xl font-semibold">Sponsored by</div>
            <div tw="flex" style={{ gap: '2rem' }}>
              {event.sponsors.map((sponsor) => (
                <div key={sponsor.id} tw="flex flex-col items-center text-center mb-4">
                  <div tw="mb-2 w-40 h-40 bg-white p-2 rounded-lg overflow-hidden flex items-center justify-center">
                    <img src={sponsor.rectangularLogo} alt={sponsor.name} />
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
                      src={speaker.profileImageUrl}
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
      <div tw="flex flex-col items-center text-center" style={{ gap: '2rem', marginTop: '14rem' }}>
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
      </div>
      <div tw="text-3xl flex justify-center" style={{ marginTop: 'auto' }}>
        Find us on allthingsweb.dev and lu.ma/allthingsweb!
      </div>
    </div>
  );
}

export function SpeakersPreview({ speakers }: { speakers: Speaker[] }) {
  const maxSpeakersToShow = 5 * 5;
  const visibleSpeakers = speakers.slice(0, maxSpeakersToShow);
  return (
    <div
      tw="w-[1200px] h-[1200px] bg-gradient-to-br flex flex-col p-16 text-white"
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
                    src={speaker.profileImageUrl}
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
