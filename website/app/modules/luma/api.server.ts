// API KEY header x-luma-api-key
// curl --request GET \
//      --url https://api.lu.ma/public/v1/calendar/list-events \
//      --header 'accept: application/json'
// query params pagination_limit pagination_crusor before after timestamps

import { env } from "../env.server";

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
    type: "google" | "string";
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
  event_type: "independent" | "series";
  user_api_id: string;
  visibility: "public" | "private";
  zoom_meeting_url: string;
  meeting_url: string;
};

export async function getUpcomingEvents() {
  const url = `https://api.lu.ma/public/v1/calendar/list-events?pagination_limit=50&after=${new Date().toISOString()}`;
  const headers = {
    accept: "application/json",
    "x-luma-api-key": env.lumaAPIKey,
  };
  const res = await fetch(url, {
    method: "GET",
    headers: headers,
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch upcoming events. Status: ${res.status} - ${res.statusText}`
    );
  }
  const resData = await res.json();
  return resData.events.entries.map((e: any) => e.event) as LumaEvent[];
}

export async function getAttendees(eventId: string) {}

export async function addAttendee(
  eventId: string,
  attendee: { email: string; name: string }
) {
  const url = `https://api.lu.ma/public/v1/event/add-guests`;
  const headers = {
    accept: "application/json",
    "content-type": "application/json",
    "x-luma-api-key": env.lumaAPIKey,
  };
  const body = {
    event_api_id: eventId,
    guests: [attendee],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `Failed to add attendee. Status: ${res.status} - ${res.statusText}`
    );
  }
  return res;
}
