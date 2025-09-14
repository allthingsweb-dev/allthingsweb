import { getImgResponse } from "openimg/node";
import sharp from "sharp";
import { mainConfig } from "@/lib/config";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const headers = new Headers();
  headers.set("cache-control", "public, max-age=172800");

  return getImgResponse(request, {
    cacheFolder:
      mainConfig.instance.environment === "production"
        ? undefined // no caching on Vercel, HTTP/CDN caching only
        : "./data/images",
    getImgSource: () => {
      const src = searchParams.get("src");
      if (!src) {
        return new Response("src query parameter is required", { status: 400 });
      }
      if (URL.canParse(src)) {
        // Remote images
        return { type: "fetch", url: src };
      }
      if (src.includes("assets")) {
        // Vite assets (for Next.js, these would be _next/static)
        return { type: "fs", path: "." + src };
      }
      // Public folder assets
      return { type: "fs", path: "./public" + src };
    },
    getSharpPipeline({ params, source }) {
      const containColor = searchParams.get("containColor");
      if (!containColor) {
        return undefined;
      }
      const pipeline = sharp().resize(params.width, params.height, {
        fit: params.fit,
        background: containColor,
      });
      if (params.format === "webp") {
        pipeline.webp();
      }
      if (params.format === "avif") {
        pipeline.avif();
      }
      if (source.type === "fs") {
        return {
          pipeline,
          cacheKey: `${source.path}-${containColor}`,
        };
      }
      if (source.type === "fetch") {
        return {
          pipeline,
          cacheKey: `${source.url}-${containColor}`,
        };
      }
      return undefined;
    },
    headers,
    allowlistedOrigins: [mainConfig.instance.origin, mainConfig.s3.url],
  });
}
