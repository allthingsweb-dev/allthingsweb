import Link from "next/link";

export default function RawAdminPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-lg rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Raw Content Admin
                </h1>
                <p className="text-gray-600 mt-1">
                  Create raw sponsors, profiles, and talks
                </p>
              </div>
              <Link
                href="/admin"
                className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                ← Back to Admin
              </Link>
            </div>
          </div>

          <div className="p-6">
            <div className="grid gap-4 md:grid-cols-3">
              <Link
                href="/admin/raw/sponsors"
                className="block p-5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <h2 className="text-lg font-semibold text-gray-900">
                  Sponsors
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  Create sponsors with dark and light logo uploads
                </p>
              </Link>

              <Link
                href="/admin/raw/profiles"
                className="block p-5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <h2 className="text-lg font-semibold text-gray-900">
                  Profiles
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  Create member/organizer profiles with optional image upload
                </p>
              </Link>

              <Link
                href="/admin/raw/talks"
                className="block p-5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <h2 className="text-lg font-semibold text-gray-900">Talks</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Create talks and assign one or more speakers
                </p>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
