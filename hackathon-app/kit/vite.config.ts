import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],

  server: {
    // Proxy requests to Phoenix server in development
    proxy: {
      "^/users/.*": "http://localhost:4000",
      "^/api/.*": "http://localhost:4000",
      "^/dev/.*": "http://localhost:4000",
      "^/assets/.*": "http://localhost:4000",
      "^/images/.*": "http://localhost:4000",
      "^/phoenix/.*": "http://localhost:4000",
      "/live": {
        target: "ws://localhost:4000",
        ws: true,
        rewriteWsOrigin: true,
      },
      "/socket": {
        target: "ws://localhost:4000",
        ws: true,
        rewriteWsOrigin: true,
      },
    },
  },
});
