import Link from "next/link";
import { stackServerApp } from "@/lib/stack";
import { isAdmin, getAllProfiles, getAllUsers } from "@/lib/admin";
import AssignProfileForm from "./assign-profile-form";

export default async function AssignProfilePage() {
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

  // Fetch all profiles and users
  const [profiles, users] = await Promise.all([
    getAllProfiles(),
    getAllUsers(),
  ]);

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white shadow-lg rounded-lg">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Assign Profile to User
                </h1>
                <p className="text-gray-600 mt-1">
                  Associate user accounts with speaker/organizer profiles
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
            <AssignProfileForm profiles={profiles} users={users} />
          </div>
        </div>
      </div>
    </div>
  );
}
