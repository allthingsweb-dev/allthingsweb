import Link from "next/link";
import { stackServerApp } from "@/lib/stack";
import { Section } from "@/components/ui/section";

export default async function AdminPage() {
  // User and admin checks are handled by the layout
  const user = await stackServerApp.getUser({ or: "redirect" });

  return (
    <Section variant="big">
      <div className="container">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white shadow-lg rounded-lg">
            <div className="px-6 py-4 border-b border-gray-200">
              <h1 className="text-2xl font-bold text-gray-900">
                Admin Dashboard
              </h1>
              <p className="text-gray-600 mt-1">
                Welcome, {user.displayName || user.primaryEmail}
              </p>
            </div>

            <div className="p-6">
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {/* Assign Profile Card */}
                <Link
                  href="/admin/assign-profile"
                  className="block p-6 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors group"
                >
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <svg
                        className="h-8 w-8 text-blue-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                        />
                      </svg>
                    </div>
                    <div className="ml-4">
                      <h3 className="text-lg font-medium text-gray-900 group-hover:text-blue-900">
                        Assign Profile to User
                      </h3>
                      <p className="text-sm text-gray-600">
                        Associate user accounts with speaker/organizer profiles
                      </p>
                    </div>
                  </div>
                </Link>

                {/* Upload Event Images Card */}
                <Link
                  href="/admin/upload-images"
                  className="block p-6 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors group"
                >
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <svg
                        className="h-8 w-8 text-green-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                        />
                      </svg>
                    </div>
                    <div className="ml-4">
                      <h3 className="text-lg font-medium text-gray-900 group-hover:text-green-900">
                        Upload Event Images
                      </h3>
                      <p className="text-sm text-gray-600">
                        Upload multiple images to any event
                      </p>
                    </div>
                  </div>
                </Link>

                {/* View Event Images Card */}
                <Link
                  href="/admin/images"
                  className="block p-6 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors group"
                >
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <svg
                        className="h-8 w-8 text-purple-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                    <div className="ml-4">
                      <h3 className="text-lg font-medium text-gray-900 group-hover:text-purple-900">
                        View Event Images
                      </h3>
                      <p className="text-sm text-gray-600">
                        Browse all uploaded event images with details and IDs
                      </p>
                    </div>
                  </div>
                </Link>

                {/* Hackathon Control Center Card */}
                <Link
                  href="/admin/hackathon-control"
                  className="block p-6 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 transition-colors group"
                >
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <svg
                        className="h-8 w-8 text-orange-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4"
                        />
                      </svg>
                    </div>
                    <div className="ml-4">
                      <h3 className="text-lg font-medium text-gray-900 group-hover:text-orange-900">
                        Hackathon Control Center
                      </h3>
                      <p className="text-sm text-gray-600">
                        Manage hackathon states and timing for events
                      </p>
                    </div>
                  </div>
                </Link>

                {/* Components Preview Card */}
                <Link
                  href="/components"
                  className="block p-6 bg-purple-50 border border-purple-200 rounded-lg hover:bg-purple-100 transition-colors group"
                >
                  <div className="flex items-center">
                    <div className="flex-shrink-0">
                      <svg
                        className="h-8 w-8 text-purple-600"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zM21 5a2 2 0 00-2-2h-4a2 2 0 00-2 2v12a4 4 0 004 4h4a2 2 0 002-2V5z"
                        />
                      </svg>
                    </div>
                    <div className="ml-4">
                      <h3 className="text-lg font-medium text-gray-900 group-hover:text-purple-900">
                        Components Preview
                      </h3>
                      <p className="text-sm text-gray-600">
                        Preview UI components in all their variants and states
                      </p>
                    </div>
                  </div>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}
