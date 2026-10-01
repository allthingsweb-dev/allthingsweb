import type { Metadata } from "next";
import Link from "next/link";
import { PageLayout } from "@/components/page-layout";
import { Section } from "@/components/ui/section";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Page not found",
};

export default function NotFound() {
  return (
    <PageLayout>
      <Section variant="first">
        <div className="container max-w-[640px] space-y-6 text-center">
          <p className="text-sm font-medium text-muted-foreground">404</p>
          <h1 className="text-4xl font-bold tracking-tight">
            We couldn’t find that page
          </h1>
          <p className="text-lg text-muted-foreground">
            The link may be old, or the event may have moved. Upcoming events
            are always on the home page.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Button asChild>
              <Link href="/">Browse events</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/speakers">Meet past speakers</Link>
            </Button>
          </div>
        </div>
      </Section>
    </PageLayout>
  );
}
