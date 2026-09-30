import { stackServerApp } from "@/lib/stack";
import { isAdmin } from "@/lib/admin";
import Link from "next/link";
import { HackathonControlCenter } from "./hackathon-control-center";

export default async function HackathonControlPage() {
  // Check if user is logged in, redirect to login if not
  const user = await stackServerApp.getUser({ or: "redirect" });

  // Check if user is admin
  const userIsAdmin = await isAdmin(user.id);

  if (!userIsAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-6">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-red-600 mb-4">
              Access Denied
            </h1>
            <p className="text-gray-600 mb-4">
              You do not have administrator privileges to access this page.
            </p>
            <Link
              href="/"
              className="inline-block bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded transition-colors"
            >
              Go to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-lg rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Hackathon Control Center
                </h1>
                <p className="text-gray-600 mt-1">
                  Manage hackathon states and timing
                </p>
              </div>
              <Link
                href="/admin"
                className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                ← Back to Admin
              </Link>
            </div>
          </div>

          <div className="p-6">
            <HackathonControlCenter />
          </div>
        </div>
      </div>
    </div>
  );
}
