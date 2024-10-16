import { MetaFunction } from '@remix-run/node';
import { getMetaTags, mergeMetaTags } from '../meta.ts';
import { type loader as rootLoader } from '~/root.tsx';
import { type loader } from './loader.sever.ts';

export const meta: MetaFunction<typeof loader, { root: typeof rootLoader }> = (
  { data, matches },
) => {
  const rootLoader = matches.find((match) => match.id === 'root')?.data;
  if (!data || !data.event || !rootLoader) {
    return mergeMetaTags([{ title: 'Event not found' }], matches);
  }
  const title = data.event.name;
  const description = data.event.tagline;
  const eventUrl = `${rootLoader.serverOrigin}/${data.event.slug}`;
  const previewImageUrl = data.event.previewImageUrl;
  return mergeMetaTags(getMetaTags(title, description, eventUrl, previewImageUrl), matches);
};
