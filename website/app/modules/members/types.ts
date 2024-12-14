export type Socials = {
  twitterUrl: string | null;
  linkedinUrl: string | null;
  blueskyUrl: string | null;
};

export type Member = Socials & {
  id: string;
  name: string;
  title: string | null;
  bio: string | null;
  profileImageUrl: string;
  type: 'member' | 'organizer';
};
