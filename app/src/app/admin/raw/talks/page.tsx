import Link from "next/link";
import { db } from "@/lib/db";
import { profilesTable, talkSpeakersTable, talksTable } from "@/lib/schema";
import { asc } from "drizzle-orm";
import CreateTalkForm from "./create-talk-form";

export default async function RawTalksAdminPage() {
  const profiles = await db
    .select({
      id: profilesTable.id,
      name: profilesTable.name,
      title: profilesTable.title,
      profileType: profilesTable.profileType,
    })
    .from(profilesTable)
    .orderBy(asc(profilesTable.name));

  const talks = await db
    .select({
      id: talksTable.id,
      title: talksTable.title,
      description: talksTable.description,
    })
    .from(talksTable)
    .orderBy(asc(talksTable.title));

  const talkSpeakers = await db
    .select({
      talkId: talkSpeakersTable.talkId,
      speakerId: talkSpeakersTable.speakerId,
    })
    .from(talkSpeakersTable);

  const speakerIdsByTalkId = talkSpeakers.reduce(
    (acc, row) => {
      if (!acc[row.talkId]) {
        acc[row.talkId] = [];
      }
      acc[row.talkId].push(row.speakerId);
      return acc;
    },
    {} as Record<string, string[]>,
  );

  const initialTalks = talks.map((talk) => ({
    ...talk,
    speakerIds: speakerIdsByTalkId[talk.id] ?? [],
  }));

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-lg rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Create Raw Talk
                </h1>
                <p className="text-gray-600 mt-1">
                  Add talks and attach one or more speakers
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
            <CreateTalkForm profiles={profiles} initialTalks={initialTalks} />
          </div>
        </div>
      </div>
    </div>
  );
}
