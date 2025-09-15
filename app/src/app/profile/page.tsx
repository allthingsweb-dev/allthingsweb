import { stackServerApp } from "@/lib/stack";
import { PageLayout } from "@/components/page-layout";
import { ProfileForm } from "@/components/profile-form";

export default async function ProfilePage() {
  // Ensure user is authenticated, redirect to login if not
  await stackServerApp.getUser({ or: "redirect" });

  return (
    <PageLayout>
      <ProfileForm />
    </PageLayout>
  );
}
