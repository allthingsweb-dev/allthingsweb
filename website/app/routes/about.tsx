import { LoaderFunctionArgs } from '@remix-run/node';
import { Link, useLoaderData } from '@remix-run/react';
import clsx from 'clsx';
import { ExternalLinkIcon, RssIcon } from 'lucide-react';
import { PageLayout } from '~/modules/components/page-layout';
import {
  BlueskyLogoIcon,
  DiscordLogoIcon,
  GitHubLogoIcon,
  LumaLogoIcon,
  TwitterLogoIcon,
} from '~/modules/components/ui/icons';
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
      <Section>
        <div className="container">
          <h2 className="text-2xl font-semibold mb-6">Join us</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <SocialBox
              title="Luma"
              description="Subscribe to our Luma calendar for event reminders."
              link="https://lu.ma/allthingsweb"
              logo={<LumaLogoIcon className="h-7 w-7" />}
            />
            <SocialBox
              title="Discord"
              description="Join our Discord server to hang out and chat about all things web."
              link="https://discord.gg/B3Sm4b5mfD"
              logo={<DiscordLogoIcon className="h-6 w-6" />}
            />
            <SocialBox
              title="Bluesky"
              description="Follow us on Bluesky for event announcements and updates."
              link="https://bsky.app/profile/allthingsweb.dev"
              logo={<BlueskyLogoIcon className="h-5 w-5" />}
            />
            <SocialBox
              title="Twitter"
              description="Follow us on X for event announcements and updates."
              link="https://x.com/reactbayarea"
              logo={<TwitterLogoIcon className="h-4 w-4" />}
            />
            <SocialBox
              title="GitHub"
              description="Contribute to our website on GitHub."
              link="https://github.com/allthingsweb-dev/allthingsweb"
              logo={<GitHubLogoIcon className="h-6 w-6" />}
            />
            <SocialBox
              title="RSS"
              description="Subscribe to our RSS feed for event announcements."
              link="/rss"
              logo={<RssIcon className="h-6 w-6" />}
            />
          </div>
        </div>
      </Section>
    </PageLayout>
  );
}

function SocialBox({
  title,
  description,
  link,
  classNames,
  logo,
}: {
  title: string;
  description: string;
  link: string;
  classNames?: string;
  logo: React.ReactNode;
}) {
  return (
    <Link
      to={link}
      className={clsx('flex items-center p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow gap-4', classNames)}
      target="_blank"
      rel="noopener noreferrer"
    >
      <div>{logo}</div>
      <div className="flex-grow">
        <h3 className="font-semibold text-lg">{title}</h3>
        <p className="text-sm opacity-90">{description}</p>
      </div>
      <div>
        <ExternalLinkIcon className="h-5 w-5" />
      </div>
    </Link>
  );
}
