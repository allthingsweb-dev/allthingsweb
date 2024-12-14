import cachified from '@epic-web/cachified';
import { getImageSrc } from '../image-opt/utils';
import { createPocketbaseClient } from '../pocketbase/api.server';
import { Member as PocketBaseMember } from '../pocketbase/pocketbase';
import { Member } from './types';
import { lru } from '../cache';

type Deps = {
  pocketbaseClient: ReturnType<typeof createPocketbaseClient>;
};

export async function fetchMembers(deps: Deps): Promise<Member[]> {
  return cachified({
    key: 'members',
    cache: lru,
    // Use cached value for 3 minutes, after one minute, fetch fresh value in the background
    // Downstream is only hit once a minute
    ttl: 60 * 1000, // one minute
    staleWhileRevalidate: 2 * 60 * 1000, // two minutes
    getFreshValue: async () => {
      const members = await deps.pocketbaseClient.getMembers();
      return members.map(toMember);
    },
  });
}

export function organizeByType(members: Member[]) {
  const organizers = members.filter((member) => member.type === 'organizer');
  const attendees = members.filter((member) => member.type === 'member');
  return { organizers, attendees };
}

function toMember(member: PocketBaseMember): Member {
  return {
    id: member.id,
    name: member.name,
    title: member.title,
    bio: member.bio,
    profileImageUrl: getImageSrc(member.profileImageUrl, { width: 200, height: 200, fit: 'cover' }),
    type: member.type,
    twitterUrl: member.twitterUrl,
    linkedinUrl: member.linkedinUrl,
    blueskyUrl: member.blueskyUrl,
  };
}
