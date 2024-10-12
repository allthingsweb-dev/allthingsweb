import { sentryVitePlugin } from '@sentry/vite-plugin';
import { vitePlugin as remix } from '@remix-run/dev';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

console.log('process.env.NODE_ENV:', Deno.env.get('NODE_ENV'));
const portFromEnv = Deno.env.get('PORT');
const port = portFromEnv ? Number.parseInt(portFromEnv) : 3000;

export default defineConfig({
  server: {
    port,
  },
  plugins: [
    remix({
      future: {
        v3_fetcherPersist: true,
        v3_relativeSplatPath: true,
        v3_throwAbortReason: true,
      },
    }),
    tsconfigPaths(),
    sentryVitePlugin({
      org: Deno.env.get('SENTRY_ORG'),
      project: Deno.env.get('SENTRY_PROJECT'),
      disable: Deno.env.get('NODE_ENV') === 'development',
    }),
  ],
  build: {
    sourcemap: true,
  },
});
