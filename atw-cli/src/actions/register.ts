import { ATW_API_BASEURL } from "../config";

export type Event = {
  id: string;
  slug: string;
  name: string;
  startDate: number;
  tagline: string;
  shortLocation: string | null;
};

export const registerAction = async (email: string, eventId: Event["id"]) => {
  const response = await fetch(
    `${ATW_API_BASEURL}/events/${eventId}/register`,
    {
      method: "POST",
      body: JSON.stringify({ email }),
    },
  );
  return await response.json();
};
