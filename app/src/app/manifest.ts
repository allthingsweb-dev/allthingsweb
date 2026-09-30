import type { MetadataRoute } from "next";
import { community } from "@/lib/community";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "All Things Web",
    short_name: "All Things Web",
    description: community.oneLiner,
    start_url: "/",
    display: "browser",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/android-chrome-192.png", sizes: "192x192", type: "image/png" },
      { src: "/android-chrome-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
