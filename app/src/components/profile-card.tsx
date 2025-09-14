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

export function SocialsList({ socials }: { socials: Socials }) {
  return (
    <nav className="flex justify-start gap-2 items-center">
      {socials.blueskyUrl && (
        <a
          href={socials.blueskyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <BlueskyLogoIcon className="h-5 w-5" />
          <span className="sr-only">Bluesky</span>
        </a>
      )}
      {socials.twitterUrl && (
        <a
          href={socials.twitterUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <TwitterLogoIcon className="h-4 w-4" />
          <span className="sr-only">Twitter</span>
        </a>
      )}
      {socials.linkedinUrl && (
        <a
          href={socials.linkedinUrl}
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
