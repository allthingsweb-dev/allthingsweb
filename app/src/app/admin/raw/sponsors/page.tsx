import Link from "next/link";
import { asc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { imagesTable, sponsorsTable } from "@/lib/schema";
import { signImage } from "@/lib/image-signing";
import CreateSponsorForm from "./create-sponsor-form";

export default async function RawSponsorsAdminPage() {
  const sponsors = await db
    .select()
    .from(sponsorsTable)
    .orderBy(asc(sponsorsTable.name));

  const imageIds = Array.from(
    new Set(
      sponsors
        .flatMap((sponsor) => [sponsor.squareLogoDark, sponsor.squareLogoLight])
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const images =
    imageIds.length > 0
      ? await db
          .select()
          .from(imagesTable)
          .where(inArray(imagesTable.id, imageIds))
      : [];
  const imageMap = new Map(images.map((image) => [image.id, image]));

  const initialSponsors = await Promise.all(
    sponsors.map(async (sponsor) => {
      const dark = sponsor.squareLogoDark
        ? (imageMap.get(sponsor.squareLogoDark) ?? null)
        : null;
      const light = sponsor.squareLogoLight
        ? (imageMap.get(sponsor.squareLogoLight) ?? null)
        : null;

      const squareLogoDarkUrl = dark
        ? (
            await signImage({
              url: dark.url,
              alt: dark.alt,
              placeholder: dark.placeholder,
              width: dark.width,
              height: dark.height,
            })
          ).url
        : null;
      const squareLogoLightUrl = light
        ? (
            await signImage({
              url: light.url,
              alt: light.alt,
              placeholder: light.placeholder,
              width: light.width,
              height: light.height,
            })
          ).url
        : null;

      return {
        ...sponsor,
        squareLogoDarkUrl,
        squareLogoLightUrl,
      };
    }),
  );

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-lg rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Create Raw Sponsor
                </h1>
                <p className="text-gray-600 mt-1">
                  Add sponsors with dark and light square logos
                </p>
              </div>
              <Link
                href="/admin/raw"
                className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
              >
                ← Back to Raw Admin
              </Link>
            </div>
          </div>

          <div className="p-6">
            <CreateSponsorForm initialSponsors={initialSponsors} />
          </div>
        </div>
      </div>
    </div>
  );
}
