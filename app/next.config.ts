import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        hostname: "allthingsweb-dev.s3.us-west-2.amazonaws.com",
      },
    ],
  },
};

export default nextConfig;
