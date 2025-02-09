import { MetaDescriptor } from "react-router";

export function getMetaTags(
  title: string,
  description: string,
  url: string,
  imageUrl?: string,
): MetaDescriptor[] {
  const imageElements = imageUrl
    ? [
        {
          name: "twitter:image",
          content: imageUrl,
        },
        {
          property: "og:image",
          content: imageUrl,
        },
        {
          name: "twitter:card",
          content: "summary_large_image",
        },
      ]
    : [];

  return [
    { title: title },
    {
      name: "twitter:title",
      content: title,
    },
    {
      property: "og:title",
      content: title,
    },
    { name: "description", content: description },
    {
      name: "twitter:description",
      content: description,
    },
    {
      property: "og:description",
      content: description,
    },
    { name: "twitter:site", content: "@ReactBayArea" },
    { name: "twitter:creator", content: "@ReactBayArea" },
    {
      property: "og:url",
      content: url,
    },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "All Things Web" },
    { property: "og:locale", content: "en_US" },
    ...imageElements,
  ];
}
