import { Speaker } from '../pocketbase/pocketbase';
import { BlueSkyLogoIcon, LinkedInLogoIcon, TwitterLogoIcon } from '../components/ui/icons';

export function SpeakerSocialsList({ speaker }: { speaker: Speaker }) {
  return (
    <div className="flex justify-start gap-2 items-center">
      {speaker.blueskyUrl && (
        <a
          href={speaker.blueskyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <BlueSkyLogoIcon className="h-5 w-5" />
          <span className="sr-only">Bluesky</span>
        </a>
      )}
      {speaker.twitterUrl && (
        <a
          href={speaker.twitterUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <TwitterLogoIcon className="h-4 w-4" />
          <span className="sr-only">Twitter</span>
        </a>
      )}
      {speaker.linkedinUrl && (
        <a
          href={speaker.linkedinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <LinkedInLogoIcon className="h-5 w-5" />
          <span className="sr-only">LinkedIn</span>
        </a>
      )}
    </div>
  );
}
