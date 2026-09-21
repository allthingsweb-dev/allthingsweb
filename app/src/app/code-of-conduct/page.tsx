import type { Metadata } from "next";
import Link from "next/link";
import { PageLayout } from "@/components/page-layout";
import { Section } from "@/components/ui/section";

export const metadata: Metadata = {
  title: "Code of conduct",
  description:
    "How we keep All Things Web welcoming, respectful, and community first, and how to report a concern.",
};

export default function CodeOfConductPage() {
  return (
    <PageLayout>
      <Section variant="first">
        <article className="container max-w-[800px] space-y-10 text-lg leading-relaxed">
          <header className="space-y-5">
            <h1 className="text-4xl font-bold tracking-tight">
              Code of conduct
            </h1>
            <p className="text-muted-foreground">
              All Things Web is a place to learn, build, share, and connect on
              equal footing. Whether you are new to tech or have spent years
              building it, you deserve respect and room to participate.
            </p>
            <p className="text-muted-foreground">
              These expectations apply to attendees, speakers, organizers,
              volunteers, and hosting companies at our events and in our
              community spaces. Job title, reputation, and hosting contributions
              do not give anyone special treatment.
            </p>
          </header>
          <section className="space-y-4" aria-labelledby="participation">
            <h2 id="participation" className="text-2xl font-semibold">
              How we show up
            </h2>
            <ul className="list-disc pl-6 space-y-3 text-muted-foreground">
              <li>
                Be curious and considerate. Ask questions, listen, share what
                you know, and make room for others.
              </li>
              <li>
                Discuss ideas without belittling the people behind them. Respect
                boundaries and stop when someone asks you to.
              </li>
              <li>
                Share useful work and honest lessons. No shilling, sales
                pitches, or pressure to buy, invest, or hand over contact
                details.
              </li>
              <li>
                Ask before photographing or recording someone directly, and
                respect requests not to be included or tagged.
              </li>
              <li>
                Help keep the venue welcoming and accessible. Follow reasonable
                venue and organizer instructions.
              </li>
            </ul>
          </section>
          <section className="space-y-4" aria-labelledby="unacceptable">
            <h2 id="unacceptable" className="text-2xl font-semibold">
              Behavior we do not accept
            </h2>
            <p className="text-muted-foreground">
              Harassment, discrimination, threats, stalking, intimidation,
              unwanted sexual attention or contact, sharing private information
              without permission, and repeated disruption are not welcome.
              Neither is retaliation against someone who raises a concern or
              helps address one.
            </p>
          </section>
          <section className="space-y-4" aria-labelledby="reporting">
            <h2 id="reporting" className="text-2xl font-semibold">
              Report a concern
            </h2>
            <p className="text-muted-foreground">
              You can speak privately to an organizer at an event or email:
            </p>
            <ul className="list-disc pl-6 space-y-3">
              <li>
                Andre Landgraf (primary):{" "}
                <Link
                  className="underline underline-offset-4 break-all"
                  href="mailto:andre@allthingsweb.dev"
                >
                  andre@allthingsweb.dev
                </Link>
              </li>
              <li>
                Erik Thorelli (backup):{" "}
                <Link
                  className="underline underline-offset-4 break-all"
                  href="mailto:erik@allthingsweb.dev"
                >
                  erik@allthingsweb.dev
                </Link>
              </li>
            </ul>
            <p className="text-muted-foreground">
              If your concern involves one organizer, contact the other
              directly. You do not need to confront the person involved before
              asking for help. Share what happened, when and where, and how we
              can contact you safely. Reports will be handled discreetly, with
              information shared only as needed to respond.
            </p>
            <p className="text-muted-foreground">
              These email addresses are not an emergency service. If there is
              immediate danger, contact local emergency services or venue staff.
            </p>
          </section>
          <section className="space-y-4" aria-labelledby="response">
            <h2 id="response" className="text-2xl font-semibold">
              How we respond
            </h2>
            <p className="text-muted-foreground">
              Organizers will listen, consider the circumstances, and take
              proportionate action. This may include a conversation, a warning,
              asking someone to stop or leave, or restricting participation in
              future events or community spaces. Someone who is the subject of a
              report should not decide its outcome. You can use the contacts
              above to ask about a decision or raise a concern about how it was
              handled.
            </p>
          </section>
        </article>
      </Section>
    </PageLayout>
  );
}
