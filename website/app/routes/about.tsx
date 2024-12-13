import { LoaderFunctionArgs } from '@remix-run/node';
import { useLoaderData } from '@remix-run/react';
import { PageLayout } from '~/modules/components/page-layout';
import { Section } from '~/modules/components/ui/section';
import { MemberCard } from '~/modules/members/components';
import { fetchMembers, organizeByType } from '~/modules/members/loader.server';

export async function loader({ context }: LoaderFunctionArgs) {
  const members = await fetchMembers({ pocketbaseClient: context.pocketBaseClient });
  const membersMap = organizeByType(members);
  return { membersMap };
}

export default function Component() {
  const { membersMap } = useLoaderData<typeof loader>();
  return (
    <PageLayout>
      <Section variant="first">
        <div className="container max-w-[800px]">
          <h1 className="text-4xl font-bold mb-8">About All Things Web</h1>
          <p className="text-lg text-gray-700">
            All Things Web is a community dedicated to organizing events for web developers in the Bay Area and San
            Francisco. Our mission is to bring together passionate developers, foster knowledge sharing, and create
            networking opportunities in the ever-evolving world of web technologies.
          </p>
        </div>
      </Section>
      <Section background="muted">
        <div className="container">
          <h2 className="text-2xl font-semibold mb-6">Organizers</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {membersMap.organizers.map((member) => (
              <MemberCard key={member.id} member={member}>
                <p className="mb-2 mt-4">{member.bio}</p>
              </MemberCard>
            ))}
          </div>
        </div>
      </Section>
    </PageLayout>
  );
}
