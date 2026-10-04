import Link from "next/link";
import { asc, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { imagesTable, hostsTable } from "@/lib/schema";
import CreateHostForm from "./create-host-form";

export default async function RawHostsAdminPage() {
  const hosts = await db
    .select()
    .from(hostsTable)
    .orderBy(asc(hostsTable.name));

  const imageIds = Array.from(
    new Set(
      hosts
        .flatMap((host) => [host.squareLogoDark, host.squareLogoLight])
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

  const imageUrl = (id: string | null) =>
    (id ? imageMap.get(id)?.url : undefined) ?? null;

  const initialHosts = hosts.map((host) => ({
    ...host,
    squareLogoDarkUrl: imageUrl(host.squareLogoDark),
    squareLogoLightUrl: imageUrl(host.squareLogoLight),
  }));

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-lg rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Create Raw Host
                </h1>
                <p className="text-gray-600 mt-1">
                  Add hosts with dark and light square logos
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
            <CreateHostForm initialHosts={initialHosts} />
          </div>
        </div>
      </div>
    </div>
  );
}
