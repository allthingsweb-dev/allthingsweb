import type { CSSProperties } from "react";
import Link from "next/link";
import NextImage from "next/image";
import { Button } from "@/components/ui/button";
import { community } from "@/lib/community";
import type { Image } from "@/lib/events";
import { distributeIntoColumns } from "@/lib/masonry";

// Four columns on large screens; columns 3 and 4 appear from md and lg up.
const columns = [
  { duration: "80s", visibility: "flex" },
  { duration: "70s", visibility: "flex" },
  { duration: "60s", visibility: "hidden md:flex" },
  { duration: "90s", visibility: "hidden lg:flex" },
] as const;

export function LandingHero({ images }: { images: Image[] }) {
  const imageColumns = distributeIntoColumns(images, columns.length);

  return (
    <section className="relative isolate w-full overflow-hidden">
      <div
        className="absolute inset-0 -z-10 grid grid-cols-2 items-start gap-x-1 md:grid-cols-3 lg:grid-cols-4"
        aria-hidden="true"
      >
        {columns.map((column, columnIndex) => (
          <div
            key={columnIndex}
            className={`${column.visibility} flex-col animate-hero-scroll motion-reduce:animate-none`}
            style={
              {
                "--hero-scroll-duration": column.duration,
                animationDelay: `${-columnIndex * 5}s`,
              } as CSSProperties
            }
          >
            {/* The column repeats once so scrolling by half of it loops seamlessly. */}
            {[0, 1].map((copy) =>
              imageColumns[columnIndex]!.map((image, index) => (
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
                      priority={copy === 0 && index === 0}
                      alt=""
                      sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    />
                  </div>
                </div>
              )),
            )}
          </div>
        ))}
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
    </section>
  );
}
