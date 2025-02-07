import { useRouteLoaderData } from 'react-router';
import { type loader as rootLoader } from '~/root';

export function useCsrfToken() {
  const data = useRouteLoaderData<typeof rootLoader>('root');
  if (!data) {
    throw new Error('useCsrfToken must be used within a route loader');
  }
  return data.csrfToken;
}
