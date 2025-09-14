import { SatoriOptions } from "satori";

/*
 * Shout-out to Jacob Paris (jacobmparis on Twitter) for this util function!
 * You can find the original blog post here: https://www.jacobparis.com/content/remix-og
 */
export async function getFont(font: string, weights = [400, 500, 600, 700]) {
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=${font}:wght@${weights.join(";")}`,
    {
      headers: {
        // Make sure it returns TTF.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1",
      },
    },
  ).then((response) => response.text());
  const resource = css.matchAll(
    /src: url\((.+)\) format\('(opentype|truetype)'\)/g,
  );
  return Promise.all(
    [...resource]
      .map((match) => match[1])
      .map((url) => fetch(url).then((response) => response.arrayBuffer()))
      .map(async (buffer, i) => ({
        name: font,
        style: "normal",
        weight: weights[i],
        data: await buffer,
      })),
  ) as Promise<SatoriOptions["fonts"]>;
}

// Image processing utilities using sharp instead of openimg
export async function getImgMetadata(buffer: ArrayBuffer) {
  const sharp = (await import("sharp")).default;
  const image = sharp(buffer);
  const metadata = await image.metadata();

  return {
    width: metadata.width || 0,
    height: metadata.height || 0,
    format: metadata.format || "png",
  };
}

export async function getImgPlaceholder(buffer: ArrayBuffer): Promise<string> {
  const sharp = (await import("sharp")).default;
  const image = sharp(buffer);

  // Generate a low-quality placeholder
  const placeholderBuffer = await image
    .resize(20, 20, { fit: "cover" })
    .blur(1)
    .png({ quality: 20 })
    .toBuffer();

  // Convert to base64 data URL
  const base64 = placeholderBuffer.toString("base64");
  return `data:image/png;base64,${base64}`;
}
