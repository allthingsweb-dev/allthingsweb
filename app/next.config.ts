const nextConfig = {
  images: {
    remotePatterns: [
      {
        hostname: "allthingsweb-dev.s3.us-west-2.amazonaws.com",
      },
    ],
    // Prefer modern formats when available
    formats: ["image/avif", "image/webp"],
    // Let Next/Vercel handle aggressive caching on the image optimizer layer
    // while providing long browser hints; optimizer adds its own SWR
    minimumCacheTTL: 60 * 60, // 1 hour baseline for optimized outputs
  },
  async headers() {
    return [
      {
        source: "/",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=300, stale-while-revalidate=1800",
          },
        ],
      },
      {
        source: "/speakers",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=300, stale-while-revalidate=1800",
          },
        ],
      },
      {
        source: "/about",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=300, stale-while-revalidate=1800",
          },
        ],
      },
      {
        // All event details pages
        source: "/events/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, s-maxage=300, stale-while-revalidate=1800",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
