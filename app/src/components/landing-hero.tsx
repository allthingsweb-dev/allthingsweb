import Link from "next/link";
import NextImage from "next/image";
import { PauseIcon, PlayIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { community } from "@/lib/community";
import type { Image } from "@/lib/events";
import { distributeIntoColumns } from "@/lib/masonry";

// Two columns on phones, three from md and four from lg. Each column scrolls
// at its own pace and starts at a different point so they never line up.
const columns = [
  {
    alwaysShown: true,
    className: "flex [--hero-scroll-duration:80s]",
  },
  {
    alwaysShown: true,
    className: "flex [--hero-scroll-duration:70s] [--hero-scroll-delay:-5s]",
  },
  {
    alwaysShown: false,
    className:
      "hidden md:flex [--hero-scroll-duration:60s] [--hero-scroll-delay:-10s]",
  },
  {
    alwaysShown: false,
    className:
      "hidden lg:flex [--hero-scroll-duration:90s] [--hero-scroll-delay:-15s]",
  },
] as const;

export function LandingHero({ images }: { images: Image[] }) {
  return (
    <section className="group/hero relative isolate w-full overflow-hidden">
      <div
        className="absolute inset-0 -z-10 grid grid-cols-2 items-start gap-x-1 md:grid-cols-3 lg:grid-cols-4"
        aria-hidden="true"
      >
        {distributeIntoColumns(images, columns).map(
          ({ column, items }, columnIndex) => (
            <div
              key={columnIndex}
              className={`${column.className} flex-col animate-hero-scroll group-has-checked/hero:[--hero-scroll-state:paused] motion-reduce:animate-none`}
            >
              {/* The column repeats once so scrolling by half of it loops seamlessly. */}
              {[0, 1].map((copy) =>
                items.map((image, index) => (
                  // Bottom padding rather than a flex gap keeps both copies the same height.
                  <div key={`${copy}-${index}`} className="pb-1">
                    <div
                      className="relative w-full"
                      style={{
                        aspectRatio:
                          image.width && image.height
                            ? `${image.width} / ${image.height}`
                            : "1 / 1",
                      }}
                    >
                      <NextImage
                        src={image.url}
                        placeholder={image.placeholder ? "blur" : "empty"}
                        blurDataURL={image.placeholder ?? undefined}
                        fill
                        className="object-cover"
                        // Only columns shown at every width preload, so phones
                        // never fetch images from columns they hide.
                        preload={
                          column.alwaysShown && copy === 0 && index === 0
                        }
                        alt={copy === 0 ? image.alt : ""}
                        sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw"
                      />
                    </div>
                  </div>
                )),
              )}
            </div>
          ),
        )}
      </div>

      <div className="min-h-[70svh] bg-gradient-to-b from-black/80 to-black/60 flex flex-col justify-center items-center py-20 sm:py-28 text-center text-white px-4">
        <h1 className="mb-4 text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight">
          All Things Web 🚀
        </h1>
        <p className="max-w-3xl text-2xl sm:text-3xl font-semibold mb-5">
          {community.oneLiner}
        </p>
        <p className="max-w-2xl text-lg sm:text-xl leading-relaxed">
          {community.introduction}
        </p>
        <div className="flex flex-wrap justify-center gap-4 mt-8">
          <Button
            asChild
            className="bg-brand-yellow text-black hover:brightness-95"
          >
            <Link href="https://luma.com/allthingsweb">
              Find your next event
            </Link>
          </Button>
          <Link
            href="/about"
            className="inline-flex items-center px-4 py-2 font-medium underline underline-offset-4 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
          >
            Meet the community
          </Link>
        </div>
      </div>

      {/* Lets anyone stop the motion without JavaScript (WCAG 2.2.2). */}
      <label className="absolute bottom-3 right-3 inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-black/50 px-2.5 py-1.5 text-xs font-medium text-white/80 hover:text-white has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-white motion-reduce:hidden">
        <input
          type="checkbox"
          aria-label="Pause background animation"
          className="peer sr-only"
        />
        <PauseIcon
          aria-hidden="true"
          className="size-3.5 peer-checked:hidden"
        />
        <PlayIcon
          aria-hidden="true"
          className="hidden size-3.5 peer-checked:block"
        />
        <span aria-hidden="true" className="peer-checked:hidden">
          Pause
        </span>
        <span aria-hidden="true" className="hidden peer-checked:inline">
          Play
        </span>
      </label>
    </section>
  );
}
