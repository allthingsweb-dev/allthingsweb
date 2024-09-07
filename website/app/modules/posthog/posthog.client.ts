import posthog from 'posthog-js';
import { clientEnv } from '../env.client';

if (clientEnv.posthogToken) {
  posthog.init(clientEnv.posthogToken, {
    api_host: 'https://us.i.posthog.com',
    person_profiles: 'identified_only', // or 'always' to create profiles for anonymous users as well
  });
}
