import { notFound } from "next/navigation";
import { getExpandedEventBySlug } from "@/lib/expanded-events";
import { isEventInPast } from "@/lib/events";
import { Section } from "@/components/ui/section";
import RegisterTeamForm from "./register-team-form";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function RegisterTeamPage({ params }: PageProps) {
  const { slug } = await params;
  const event = await getExpandedEventBySlug(slug);
  if (!event || !event.isHackathon) {
    notFound();
  }
  const disabled = isEventInPast(event);

  return (
    <Section variant="big">
      <div className="container max-w-3xl">
        <h1 className="text-2xl sm:text-3xl font-bold mb-6">Register your team</h1>
        {disabled ? (
          <p className="text-muted-foreground">This event has ended. Team registration is closed.</p>
        ) : (
          <RegisterTeamForm slug={slug} disabled={disabled} />
        )}
      </div>
    </Section>
  );
}

