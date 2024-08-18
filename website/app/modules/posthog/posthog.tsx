import { useEffect } from "react";
import posthog from "posthog-js";

export function PosthogInit() {
    useEffect(() => {
      const meta = document.querySelector('meta[name="x-posthog"]') as HTMLMetaElement | null;
      if (!meta) {
        return;
      }
      posthog.init(meta.content, {
        api_host: 'https://us.i.posthog.com',
        person_profiles: 'identified_only', // or 'always' to create profiles for anonymous users as well
      });
    }, []);
  
    return null;
  }