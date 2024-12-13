import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../components/ui/card';
import { BlueskyLogoIcon, LinkedInLogoIcon, TwitterLogoIcon } from '../components/ui/icons';
import { Socials } from './types';

export type MemberProp = Socials & {
  id: string;
  name: string;
  title: string | null;
  bio: string | null;
  profileImageUrl: string;
};

export function MemberCard({ member, children }: { member: MemberProp; children?: React.ReactNode }) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-center gap-4 pb-2">
        <img
          src={member.profileImageUrl}
          alt={member.name}
          width={200}
          height={200}
          className="rounded-full w-20 h-20 object-cover"
        />
        <div>
          <CardTitle className="text-xl">{member.name}</CardTitle>
          <p className="text-sm text-muted-foreground">{member.title}</p>
        </div>
      </CardHeader>
      <CardContent className="flex-grow">{children}</CardContent>
      <CardFooter>
        <SocialsList socials={member} />
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
