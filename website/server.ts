import * as Sentry from "@sentry/node";
import { buildContainer } from "~/modules/container.server";

let container = buildContainer();
const logger = container.cradle.logger;
logger.info(`Starting app...`);
logger.start(
  `Server timezone offset: ${new Date().getTimezoneOffset() / 60} hours`,
);

// Must be done before importing anything else
if (process.env.SENTRY_DSN) {
  logger.log("Initializing Sentry for the express server");
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: 1,
    environment: process.env.NODE_ENV,
  });
}

import compression from "compression";
import express, {
  NextFunction,
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";
import morgan from "morgan";

// Short-circuit the type-checking of the built output.
const BUILD_PATH = "./build/server/index.js";
const DEVELOPMENT = container.cradle.mainConfig.environment === "development";
const PORT = container.cradle.mainConfig.port;

const app = express();

app.use(compression());
app.disable("x-powered-by");

app.use("/tests/errors/server-error", () => {
  throw new Error("This is a test error from Express on Node.");
});

if (DEVELOPMENT) {
  console.log("Starting development server");
  const viteDevServer = await import("vite").then((vite) =>
    vite.createServer({
      server: { middlewareMode: true },
    }),
  );
  app.use(viteDevServer.middlewares);
  app.use(async (req, res, next) => {
    try {
      const source = await viteDevServer.ssrLoadModule("./server/app.ts");
      const getRemixExpressApp = source.getRemixExpressApp;
      const app = getRemixExpressApp(container);
      return await app(req, res, next);
    } catch (error) {
      if (typeof error === "object" && error instanceof Error) {
        viteDevServer.ssrFixStacktrace(error);
      }
      next(error);
    }
  });
} else {
  console.log("Starting production server");
  app.use(
    "/assets",
    express.static("build/client/assets", { immutable: true, maxAge: "1y" }),
  );
  app.use(express.static("build/client", { maxAge: "1h" }));
  app.use(
    await import(BUILD_PATH).then((mod) => mod.getRemixExpressApp(container)),
  );
}

app.use(
  morgan("tiny", {
    stream: {
      write: (message) => {
        container.cradle.logger.info(message.trim());
      },
    },
  }),
);

// Add this after all routes,
// but before any and other error-handling middlewares are defined
Sentry.setupExpressErrorHandler(app);

// Log errors to console
app.use(
  (
    err: Error,
    _req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ) => {
    console.error(err);
    next(err);
  },
);

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
