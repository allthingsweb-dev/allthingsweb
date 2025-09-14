import { Profile, Socials } from "@/lib/profiles";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  BlueskyLogoIcon,
  LinkedInLogoIcon,
  TwitterLogoIcon,
} from "@/components/ui/icons";
import NextImage from "next/image";

export function ProfileCard({
  profile,
  children,
}: {
  profile: Profile;
  children?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-center gap-4 pb-2">
        <NextImage
          src={profile.image.url}
          alt={profile.name}
          placeholder={profile.image.placeholder ? "blur" : undefined}
          blurDataURL={profile.image.placeholder || undefined}
          width={80}
          height={80}
          className="rounded-full object-cover w-20 h-20"
        />
        <div>
          <CardTitle className="text-xl">{profile.name}</CardTitle>
          <p className="text-sm text-muted-foreground">{profile.title}</p>
        </div>
      </CardHeader>
      <CardContent className="flex-grow">{children}</CardContent>
      <CardFooter>
        <SocialsList socials={profile.socials} />
      </CardFooter>
    </Card>
  );
}

// Support both formats: full URLs (Socials) and handles (SpeakerSocials)
type SpeakerSocials = {
  twitter?: string;
  bluesky?: string;
  linkedin?: string;
};

export function SocialsList({
  socials,
}: {
  socials: Socials | SpeakerSocials;
}) {
  // Check if it's the full URL format (Socials) or handle format (SpeakerSocials)
  const isUrlFormat =
    "twitterUrl" in socials ||
    "blueskyUrl" in socials ||
    "linkedinUrl" in socials;

  const getUrls = () => {
    if (isUrlFormat) {
      const urlSocials = socials as Socials;
      return {
        twitter: urlSocials.twitterUrl,
        bluesky: urlSocials.blueskyUrl,
        linkedin: urlSocials.linkedinUrl,
      };
    } else {
      const handleSocials = socials as SpeakerSocials;
      return {
        twitter: handleSocials.twitter
          ? `https://twitter.com/${handleSocials.twitter}`
          : null,
        bluesky: handleSocials.bluesky
          ? `https://bsky.app/profile/${handleSocials.bluesky}`
          : null,
        linkedin: handleSocials.linkedin
          ? `https://linkedin.com/in/${handleSocials.linkedin}`
          : null,
      };
    }
  };

  const urls = getUrls();

  return (
    <nav className="flex justify-start gap-2 items-center">
      {urls.bluesky && (
        <a
          href={urls.bluesky}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <BlueskyLogoIcon className="h-5 w-5" />
          <span className="sr-only">Bluesky</span>
        </a>
      )}
      {urls.twitter && (
        <a
          href={urls.twitter}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <TwitterLogoIcon className="h-4 w-4" />
          <span className="sr-only">Twitter</span>
        </a>
      )}
      {urls.linkedin && (
        <a
          href={urls.linkedin}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <LinkedInLogoIcon className="h-5 w-5" />
          <span className="sr-only">LinkedIn</span>
        </a>
      )}
    </nav>
  );
}
