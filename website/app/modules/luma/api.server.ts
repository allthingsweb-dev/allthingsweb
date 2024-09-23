import { env } from '../env.server';

export type LumaEvent = {
  app_id: string;
  created_at: string;
  cover_url: string;
  name: string;
  description: string;
  description_md: string;
  series_api_id?: string;
  start_at: string;
  duration_interval: string;
  end_at: string;
  geo_address_json: {
    city: string;
    type: 'google' | 'string';
    country: string;
    latitude: number;
    longitude: number;
    place_id: string;
    address: string;
    description: string;
    city_state: string;
    full_address: string;
  };
  geo_latitude: number;
  geo_longitude: number;
  url: string;
  timezone: string;
  event_type: 'independent' | 'series';
  user_api_id: string;
  visibility: 'public' | 'private';
  zoom_meeting_url: string;
  meeting_url: string;
};

export type LumaAttendee = {
  api_id: string;
  approval_status: 'approved' | 'declined' | 'pending_approval' | 'rejected';
  created_at: string;
  registered_at: string;
  user_api_id: string;
  user_name: string;
  user_email: string;
  name: string;
  email: string;
};

export async function getUpcomingEvents(): Promise<LumaEvent[]> {
  if (!env.lumaAPIKey) {
    console.warn('Did not fetch upcoming events because env.lumaAPIKey is not set');
    return [];
  }
  const url = `https://api.lu.ma/public/v1/calendar/list-events?pagination_limit=50&after=${new Date().toISOString()}`;
  const headers = {
    accept: 'application/json',
    'x-luma-api-key': env.lumaAPIKey,
  };
  const res = await fetch(url, {
    method: 'GET',
    headers: headers,
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch upcoming events. Status: ${res.status} - ${res.statusText}`);
  }
  const resData = await res.json();
  return resData.events.entries.map((e: any) => e.event);
}

export async function getAttendees(
  eventId: string,
  options?: {
    cursor?: string;
    approvalStatus?: LumaAttendee['approval_status'];
  },
) {
  if (!env.lumaAPIKey) {
    console.warn('Did not fetch attendees because env.lumaAPIKey is not set');
    return [];
  }
  const urlSearchParams = new URLSearchParams({
    event_api_id: eventId,
    pagination_limit: '50', // 50 is the maximum limit
  });
  if (options?.cursor) {
    urlSearchParams.append('pagination_cursor', options.cursor);
  }
  if (options?.approvalStatus) {
    urlSearchParams.append('approval_status', options.approvalStatus);
  }
  const url = `https://api.lu.ma/public/v1/event/get-guests?${urlSearchParams.toString()}`;
  const headers = {
    accept: 'application/json',
    'x-luma-api-key': env.lumaAPIKey,
  };
  const res = await fetch(url, {
    method: 'GET',
    headers: headers,
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch attendees. Status: ${res.status} - ${res.statusText}`);
  }
  const resData = await res.json();
  const attendees = resData.entries.map((e: any) => e.guest);
  return [attendees, { hasMoreToFetch: resData.has_more, nextCursor: resData.next_cursor }];
}

export async function getAllAttendees(
  eventId: string,
  { approvalStatus }: { approvalStatus?: LumaAttendee['approval_status'] } = {},
) {
  let attendees: LumaAttendee[] = [];
  let hasMore = true;
  let cursor: string | undefined;
  while (hasMore) {
    const [newAttendees, { hasMoreToFetch, nextCursor }] = await getAttendees(eventId, { cursor, approvalStatus });
    attendees = [...attendees, ...newAttendees];
    hasMore = hasMoreToFetch;
    cursor = nextCursor;
  }
  return attendees;
}

export async function getAttendeeCount(eventId: string) {
  const attendees = await getAllAttendees(eventId, { approvalStatus: 'approved' });
  return attendees.length;
}

export async function addAttendee(eventId: string, attendee: { email: string; name: string }) {
  if (!env.lumaAPIKey) {
    console.warn('Did not add attendee because env.lumaAPIKey is not set', { eventId, attendee });
    return;
  }
  const url = `https://api.lu.ma/public/v1/event/add-guests`;
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-luma-api-key': env.lumaAPIKey,
  };
  const body = {
    event_api_id: eventId,
    guests: [attendee],
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Failed to add attendee. Status: ${res.status} - ${res.statusText}`);
  }
  return res;
}
