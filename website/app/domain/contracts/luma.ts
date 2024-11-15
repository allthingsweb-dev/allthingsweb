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

export type LumaClient = {
  getUpcomingEvents: () => Promise<LumaEvent[]>;
  getAttendees: (
    eventId: string,
    options?: {
      cursor?: string;
      approvalStatus?: LumaAttendee['approval_status'];
    },
  ) => Promise<[LumaAttendee[], { hasMoreToFetch: boolean; nextCursor: string | undefined }]>;
  getAllAttendees: (
    eventId: string,
    options?: {
      approvalStatus?: LumaAttendee['approval_status'];
    },
  ) => Promise<LumaAttendee[]>;
  getAttendeeCount: (eventId: string) => Promise<number>;
  addAttendee: (eventId: string, attendee: { email: string; name: string }) => Promise<Response | undefined>;
};
