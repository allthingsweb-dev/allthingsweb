import Link from "next/link";
import NextImage from "next/image";
import { PauseIcon, PlayIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { community } from "@/lib/community";
import type { Image } from "@/lib/events";
import { placeInColumns } from "@/lib/masonry";

// Two columns on phones, three from md and four from lg, matching the grid
// below. Every layout shows every photo, so a phone's two columns are as tall
// as the hero even on the narrowest screens. Class names stay literal so
// Tailwind can see them.
const layouts = [
  { columns: 2, hide: "hidden", show: "block" },
  { columns: 3, hide: "md:hidden", show: "md:block" },
  { columns: 4, hide: "lg:hidden", show: "lg:block" },
] as const;

// Each column scrolls at its own pace from its own starting point so the
// columns never line up.
const columnClasses = [
  "flex [--hero-scroll-duration:80s]",
  "flex [--hero-scroll-duration:70s] [--hero-scroll-delay:-5s]",
  "hidden md:flex [--hero-scroll-duration:60s] [--hero-scroll-delay:-10s]",
  "hidden lg:flex [--hero-scroll-duration:90s] [--hero-scroll-delay:-15s]",
];

export function LandingHero({ images }: { images: Image[] }) {
  return (
    <section className="group/hero relative isolate w-full overflow-hidden">
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

      {/* Painted behind the copy but read after it, so the heading and links
          come first. Each photo's first copy carries its alt text. */}
      <div className="absolute inset-0 -z-10 grid grid-cols-2 items-start gap-x-1 md:grid-cols-3 lg:grid-cols-4">
        {placeInColumns(
          images,
          layouts.map((layout) => layout.columns),
        ).map((placements, columnIndex) => (
          <div
            key={columnIndex}
            className={`${columnClasses[columnIndex]} flex-col animate-hero-scroll group-has-checked/hero:[--hero-scroll-state:paused] motion-reduce:animate-none`}
          >
            {/* The column repeats once so scrolling by half of it loops seamlessly. */}
            {[0, 1].map((copy) =>
              placements.map(({ item: image, index, shownAt }) => (
                // Bottom padding rather than a flex gap keeps both copies the same height.
                <div
                  key={`${copy}-${index}`}
                  className={`pb-1 ${layouts
                    .map((layout, layoutIndex) =>
                      shownAt[layoutIndex] ? layout.show : layout.hide,
                    )
                    .join(" ")}`}
                >
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
                      // The first row of the phone layout tops a column at
                      // every width, so only those photos preload.
                      preload={copy === 0 && index < layouts[0].columns}
                      alt={copy === 0 ? image.alt : ""}
                      sizes="(max-width: 767px) 50vw, (max-width: 1023px) 33vw, 25vw"
                    />
                  </div>
                </div>
              )),
            )}
          </div>
        ))}
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
