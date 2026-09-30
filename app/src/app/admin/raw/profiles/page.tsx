import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { imagesTable, profilesTable } from "@/lib/schema";
import { signImage } from "@/lib/image-signing";
import CreateProfileForm from "./create-profile-form";

export default async function RawProfilesAdminPage() {
  const profileRows = await db
    .select({
      id: profilesTable.id,
      name: profilesTable.name,
      title: profilesTable.title,
      bio: profilesTable.bio,
      profileType: profilesTable.profileType,
      twitterHandle: profilesTable.twitterHandle,
      blueskyHandle: profilesTable.blueskyHandle,
      linkedinHandle: profilesTable.linkedinHandle,
      imageId: profilesTable.image,
      imageUrl: imagesTable.url,
    })
    .from(profilesTable)
    .leftJoin(imagesTable, eq(profilesTable.image, imagesTable.id))
    .orderBy(asc(profilesTable.name));

  const initialProfiles = await Promise.all(
    profileRows.map(async (row) => ({
      ...row,
      imageUrl: row.imageUrl
        ? (
            await signImage({
              url: row.imageUrl,
              alt: "",
              placeholder: "",
              width: 0,
              height: 0,
            })
          ).url
        : null,
    })),
  );

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-lg rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Create Raw Profile
                </h1>
                <p className="text-gray-600 mt-1">
                  Add organizer or member profiles directly
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/admin/raw"
                  className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50"
                >
                  ← Back to Raw Admin
                </Link>
              </div>
            </div>
          </div>

          <div className="p-6">
            <CreateProfileForm initialProfiles={initialProfiles} />
          </div>
        </div>
      </div>
    </div>
  );
}
