/**
 * Venues the first public-feed sync (2026-09-16) overwrote with Luma's
 * placeholder, as they were before it: public venue data, the same as
 * app/src/lib/luma/venue-archive.json (a test holds the two together). The
 * sync restores a venue field from here only while it still holds the
 * placeholder and Luma still shows no venue.
 */
export interface ArchivedVenue {
  readonly lumaEventId: string;
  readonly streetAddress: string;
  readonly shortLocation: string;
  readonly fullAddress: string;
}

export const venueArchive: ReadonlyArray<ArchivedVenue> = [
  {
    lumaEventId: "evt-deGtRGSvYsWMqAc",
    streetAddress: "444 De Haro St #218",
    shortLocation: "Convex HQ",
    fullAddress: "444 De Haro St #218, San Francisco, CA 94107, USA",
  },
  {
    lumaEventId: "evt-7CaqG4UZsbIQb6s",
    streetAddress: "100 1st St #2400",
    shortLocation: "Vercel HQ",
    fullAddress: "100 First Plaza, 100 1st St #2400, San Francisco, CA 94105",
  },
  {
    lumaEventId: "evt-dbF3WPClKyxWQ7n",
    streetAddress: "45 Fremont St",
    shortLocation: "Sentry, SF",
    fullAddress: "45 Fremont St, San Francisco, CA 94105",
  },
  {
    lumaEventId: "evt-HtDmTqndK1vA1Z4",
    streetAddress: "500 Terry A Francois Blvd",
    shortLocation: "Meraki HQ",
    fullAddress:
      "Cisco Meraki, 500 Terry A Francois Blvd, San Francisco, CA 94158",
  },
];
