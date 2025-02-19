import { reactRouter } from "@react-router/dev/vite";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { defineConfig } from "vite";
import { openimg } from "openimg/vite";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig(({ isSsrBuild, command }) => ({
  build: {
    sourcemap: process.env.NODE_ENV !== "development",
    rollupOptions: isSsrBuild
      ? {
          input: "./server/app.ts",
          external: ["@resvg/resvg-js", "sharp"],
        }
      : undefined,
  },
  ssr: {
    noExternal: command === "build" ? true : undefined,
  },
  plugins: [
    openimg(),
    reactRouter(),
    tsconfigPaths(),
    sentryVitePlugin({
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      disable: process.env.NODE_ENV === "development",
    }),
  ],
}));
