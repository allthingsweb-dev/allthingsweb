import type { Thing, WithContext } from "schema-dts";
import { serializeJsonLd } from "@/lib/structured-data";

export function JsonLd({ data }: { data: WithContext<Thing> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
