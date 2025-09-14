import clsx from "clsx";
import Link from "next/link";
import { Metadata } from "next";
import { mainConfig } from "@/lib/config";
import { ExternalLinkIcon, RssIcon } from "lucide-react";
import { PageLayout } from "@/components/page-layout";
import {
  BlueskyLogoIcon,
  DiscordLogoIcon,
  GitHubLogoIcon,
  LumaLogoIcon,
  TwitterLogoIcon,
  YouTubeLogoIcon,
} from "@/components/ui/icons";
import { Section } from "@/components/ui/section";
import { ProfileCard } from "@/components/profile-card";
import { getOrganizers } from "@/lib/profiles";

const title = "About All Things Web";
const description =
  "All Things Web is a community dedicated to organizing events for web developers in the Bay Area and San Francisco. Check out our organizers and join us!";
const url = `${mainConfig.instance.origin}/about`;
const imageUrl = `${mainConfig.instance.origin}/api/preview.png`;

export const metadata: Metadata = {
  title,
  description,
  openGraph: {
    title,
    description,
    url,
    images: [
      {
        url: imageUrl,
        width: 1200,
        height: 630,
        alt: title,
      },
    ],
    type: "website",
    siteName: "All Things Web",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [imageUrl],
    site: "@ReactBayArea",
    creator: "@ReactBayArea",
  },
};

async function getAboutData() {
  const organizers = await getOrganizers();
  return { organizers };
}

export default async function AboutPage() {
  const { organizers } = await getAboutData();

  return (
    <PageLayout>
      <Section variant="first">
        <div className="container max-w-[800px]">
          <h1 className="text-4xl font-bold mb-8 text-foreground">
            About All Things Web
          </h1>
          <p className="text-lg text-muted-foreground">
            All Things Web is a community dedicated to organizing events for web
            developers in the Bay Area and San Francisco. Our mission is to
            bring together passionate developers, foster knowledge sharing, and
            create networking opportunities in the ever-evolving world of web
            technologies.
          </p>
        </div>
      </Section>
      <Section background="muted">
        <div className="container">
          <h2 className="text-2xl font-semibold mb-6 text-foreground">
            Organizers
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {organizers.map((profile) => (
              <ProfileCard key={profile.id} profile={profile}>
                <p className="mb-2 mt-4">{profile.bio}</p>
              </ProfileCard>
            ))}
          </div>
        </div>
      </Section>
      <Section>
        <div className="container">
          <h2 className="text-2xl font-semibold mb-6 text-foreground">
            Join us
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            <SocialBox
              title="Luma"
              description="Subscribe to our Luma calendar for event reminders."
              link="https://lu.ma/allthingsweb?utm_source=web"
              logo={<LumaLogoIcon className="h-7 w-7" />}
            />
            <SocialBox
              title="Discord"
              description="Join our Discord server to hang out and chat about all things web."
              link="https://discord.gg/B3Sm4b5mfD"
              logo={<DiscordLogoIcon className="h-6 w-6" />}
            />
            <SocialBox
              title="YouTube"
              description="Subscribe to our YouTube channel for event recordings & our podcast."
              link="https://www.youtube.com/@allthingsweb-dev/videos"
              logo={<YouTubeLogoIcon className="h-6 w-6" />}
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
              link="https://x.com/allthingswebdev"
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
      href={link}
      className={clsx(
        "flex items-center p-6 rounded-lg border bg-card text-card-foreground shadow-sm hover:shadow-md transition-shadow gap-4 hover:bg-accent/50",
        classNames,
      )}
      target="_blank"
      rel="noopener noreferrer"
    >
      <div className="text-primary">{logo}</div>
      <div className="flex-grow">
        <h3 className="font-semibold text-lg text-card-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="text-muted-foreground">
        <ExternalLinkIcon className="h-5 w-5" />
      </div>
    </Link>
  );
}
