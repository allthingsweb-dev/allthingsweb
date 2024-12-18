import { MetaFunction } from '@remix-run/node';
import { NavLink, useLoaderData } from '@remix-run/react';
import { PageLayout } from '~/modules/components/page-layout';
import { Section } from '~/modules/components/ui/section';
import { toYearStr } from '~/modules/datetime';
import { getMetaTags, mergeMetaTags } from '~/modules/meta';
import { type loader as rootLoader } from '~/root';
import { speakersLoader as loader } from '~/modules/speakers/loader.server';
import { getImageSrc } from '~/modules/image-opt/utils';
import { MemberCard } from '~/modules/members/components';

export { headers } from '~/modules/header.server';

export const meta: MetaFunction<typeof loader, { root: typeof rootLoader }> = ({ data, matches }) => {
  const rootLoader = matches.find((match) => match.id === 'root')?.data;
  if (!data || !data.speakersWithTalks || !rootLoader) {
    return mergeMetaTags([{ title: 'Speakers not found' }], matches);
  }
  const title = `Our ${data.speakersWithTalks.length} speakers`;
  const description =
    'Huge shout-out to all the speakers who have shared their knowledge and experience with us. Check out their talks from our events!';
  const previewImageUrl = `${rootLoader.serverOrigin}/speakers.png`;
  return mergeMetaTags(getMetaTags(title, description, '/speakers', previewImageUrl), matches);
};

export { loader };

export default function Component() {
  const { speakersWithTalks } = useLoaderData<typeof loader>();
  return (
    <PageLayout>
      <Section variant="big">
        <div className="container">
          <div className="flex flex-col justify-center items-center gap-2 mb-16">
            <h1 className="text-3xl font-bold tracking-tighter sm:text-5xl xl:text-6xl/none text-center">Speakers</h1>
            <p className="max-w-[600px] text-muted-foreground md:text-xl text-center">
              Huge shout-out to all the speakers who have shared their knowledge and experience with us. Check out their
              talks below!
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {speakersWithTalks.map((speaker) => (
              <MemberCard
                key={speaker.id}
                member={{
                  ...speaker,
                  profileImageUrl: getImageSrc(speaker.profileImageUrl, { width: 200, height: 200, fit: 'cover' }),
                }}
              >
                <>
                  <h3 className="text-lg font-semibold mb-2 mt-4">Talks:</h3>
                  <ul className="space-y-2">
                    {speaker.talks.map((talk) => (
                      <li key={talk.id} className="list-disc ml-6">
                        <NavLink
                          to={`/${talk.eventSlug}#talks`}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          {talk.title}
                        </NavLink>
                        <p className="text-sm text-muted-foreground">
                          {talk.eventName} {toYearStr(new Date(talk.eventStart))}
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              </MemberCard>
            ))}
          </div>
        </div>
      </Section>
    </PageLayout>
  );
}
