import { EventWithSpeakers } from "../pocketbase/pocketbase";

declare module "react" {
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

export default function EventPreview({
  event,
}: {
  event: EventWithSpeakers;
  serverOrigin: string;
}) {
  return (
    <div
      tw="w-[1200px] h-[1200px] bg-gradient-to-br flex flex-col p-16 text-white"
      style={{
        background:
          "linear-gradient(to bottom right, #3b0d60, #4b0082, #2d0031, #000000)",
      }}
    >
      <div tw="flex justify-between items-start">
        <div tw="flex flex-col" style={{ gap: "1rem" }}>
          <div tw="text-2xl font-semibold">Sponsored by</div>
          <div tw="flex" style={{ gap: "2rem" }}>
            <div tw="w-40 h-40 bg-white rounded-lg flex items-center justify-center">
              <span tw="text-gray-400">Sentry</span>
            </div>
          </div>
        </div>
        {!!event.speakers.length && (
          <div tw="flex flex-col" style={{ gap: "1rem" }}>
            <div tw="text-2xl font-semibold">Speakers</div>
            <div tw="flex" style={{ gap: "2rem" }}>
              {event.speakers.map((speaker) => (
                <div tw="flex flex-col items-center text-center">
                  <div tw="w-40 h-40 bg-gray-300 rounded-full mb-2 overflow-hidden flex items-center justify-center">
                    <img
                      src={speaker.profileImage}
                      alt={speaker.name}
                      width={160}
                      height={160}
                      tw="object-fill"
                    />
                  </div>
                  <div tw="font-semibold">{speaker.name}</div>
                  <div tw="text-sm opacity-75">{speaker.title}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div
        tw="flex flex-col items-center text-center"
        style={{ gap: "2rem", marginTop: "14rem" }}
      >
        <h1 tw="text-8xl font-bold leading-tight max-w-[1100px]">
          {event.name}
        </h1>
        <div tw="text-3xl flex justify-center" style={{ gap: "2rem" }}>
          <div tw="flex items-center">
            <CalendarIcon />
            {event.start.toLocaleDateString("en-US", {
              weekday: "short",
              year: "numeric",
              month: "short",
              day: "numeric",
            })}
          </div>
          <div tw="flex items-center">
            <MapPinIcon />
            {event.shortLocation}
          </div>
        </div>
      </div>
      <div tw="text-3xl flex justify-center" style={{ marginTop: "auto" }}>
        Join us for 48 hours of coding, innovation, and fun!
      </div>
    </div>
  );
}
