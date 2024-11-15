import { Logger } from 'vite';
import { MainConfig } from '~/domain/contracts/config';
import { LumaAttendee, LumaClient } from '~/domain/contracts/luma';

type Deps = {
  mainConfig: MainConfig;
  logger: Logger;
};

export const createLumaClient = ({ mainConfig, logger }: Deps): LumaClient => {
  if (!mainConfig.luma.apiKey) {
    return {
      getUpcomingEvents: async () => {
        logger.warn('Did not fetch upcoming events because env.lumaAPIKey is not set');
        return [];
      },
      getAttendees: async () => {
        logger.warn('Did not fetch attendees because env.lumaAPIKey is not set');
        return [[], { hasMoreToFetch: false, nextCursor: undefined }];
      },
      getAllAttendees: async () => {
        logger.warn('Did not fetch all attendees because env.lumaAPIKey is not set');
        return [];
      },
      getAttendeeCount: async () => {
        logger.warn('Did not fetch attendee count because env.lumaAPIKey is not set');
        return 0;
      },
      addAttendee: async () => {
        logger.warn('Did not add attendee because env.lumaAPIKey is not set');
        return undefined;
      },
    } as LumaClient;
  }

  const getUpcomingEvents = async () => {
    const url = `https://api.lu.ma/public/v1/calendar/list-events?pagination_limit=50&after=${new Date().toISOString()}`;
    const headers = {
      accept: 'application/json',
      'x-luma-api-key': mainConfig.luma.apiKey,
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
  };

  const getAttendees = async (
    eventId: string,
    options?: {
      cursor?: string;
      approvalStatus?: LumaAttendee['approval_status'];
    },
  ): Promise<[LumaAttendee[], { hasMoreToFetch: boolean; nextCursor: string | undefined }]> => {
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
      'x-luma-api-key': mainConfig.luma.apiKey,
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
  };

  const getAllAttendees = async (
    eventId: string,
    { approvalStatus }: { approvalStatus?: LumaAttendee['approval_status'] } = {},
  ) => {
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
  };

  const getAttendeeCount = async (eventId: string) => {
    const attendees = await getAllAttendees(eventId, { approvalStatus: 'approved' });
    return attendees.length;
  };

  const addAttendee = async (eventId: string, attendee: { email: string; name: string }) => {
    if (!mainConfig.luma.apiKey) {
      console.warn('Did not add attendee because env.lumaAPIKey is not set', { eventId, attendee });
      return;
    }
    const url = `https://api.lu.ma/public/v1/event/add-guests`;
    const headers = {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-luma-api-key': mainConfig.luma.apiKey,
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
  };

  return {
    getUpcomingEvents,
    getAttendees,
    getAllAttendees,
    getAttendeeCount,
    addAttendee,
  };
};
