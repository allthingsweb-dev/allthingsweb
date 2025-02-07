import { MetaFunction } from 'react-router';
import { getMetaTags, mergeMetaTags } from '../meta';
import { type loader as rootLoader } from '~/root';
import { type loader } from './loader.sever';

export const meta: MetaFunction<typeof loader, { root: typeof rootLoader }> = ({ data, matches }) => {
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
