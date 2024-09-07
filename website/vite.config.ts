import { sentryVitePlugin } from '@sentry/vite-plugin';
import { vitePlugin as remix } from '@remix-run/dev';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

console.log('process.env.NODE_ENV:', process.env.NODE_ENV);

export default defineConfig({
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
      org: 'andre-0g',
      project: 'allthingsweb-app',
      disable: process.env.NODE_ENV === 'development',
    }),
  ],

  build: {
    sourcemap: true,
  },
});
