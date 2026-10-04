export type Socials = {
  twitterUrl: string | null;
  linkedinUrl: string | null;
  blueskyUrl: string | null;
};

export function getSocialUrls(socials: {
  linkedinHandle?: string | null | undefined;
  twitterHandle?: string | null | undefined;
  blueskyHandle?: string | null | undefined;
}): Socials {
  return {
    linkedinUrl: socials.linkedinHandle
      ? `https://www.linkedin.com/in/${socials.linkedinHandle}`
      : null,
    twitterUrl: socials.twitterHandle
      ? `https://twitter.com/${socials.twitterHandle}`
      : null,
    blueskyUrl: socials.blueskyHandle
      ? `https://bsky.app/profile/${socials.blueskyHandle}`
      : null,
  };
}
