import "react-router";
import { createRequestHandler } from "@react-router/express";
import compression from "compression";
import express, {
  NextFunction,
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";
import morgan from "morgan";
import { MainConfig } from "~/config.server.js";
import { buildContainer } from "~/modules/container.server.js";
import { Logger } from "~/modules/logger.server.js";
import { ServerTimingsProfiler } from "~/modules/server-timing.server.js";
import { SessionManager } from "~/modules/session/create-session-manager.server.js";
import * as Sentry from "@sentry/bun";
import { DatabaseClient } from "~/modules/db/client.server";
import { DbQueryClient } from "~/modules/db/queries.server";
import { QueryClient } from "~/modules/allthingsweb/client.server";
import { S3Client } from "~/modules/s3/client.server";

let container = buildContainer();
const logger = container.cradle.logger;
logger.info(`Starting app...`);
logger.start(
  `Server timezone offset: ${new Date().getTimezoneOffset() / 60} hours`,
);

if (container.cradle.mainConfig.sentry.dsn) {
  logger.log("Initializing Sentry for the express server");
  Sentry.init({
    dsn: container.cradle.mainConfig.sentry.dsn,
    tracesSampleRate: 1,
    environment: container.cradle.mainConfig.environment,
  });
}

declare module "react-router" {
  interface AppLoadContext {
    logger: Logger;
    session: SessionManager;
    mainConfig: MainConfig;
    services: ReturnType<typeof buildContainer>["cradle"];
    serverTimingsProfiler: ServerTimingsProfiler;
    db: DatabaseClient;
    dbQueryClient: DbQueryClient;
    s3Client: S3Client;
    queryClient: QueryClient;
  }
}

export const app = express();

app.use(compression());

// http://expressjs.com/en/advanced/best-practice-security.html#at-a-minimum-disable-x-powered-by-header
app.disable("x-powered-by");

app.use(
  morgan("tiny", {
    stream: {
      write: (message) => {
        container.cradle.logger.info(message.trim());
      },
    },
  }),
);

app.use("/tests/errors/server-error", () => {
  throw new Error("This is a test error from Express on Bun.");
});

app.use(
  createRequestHandler({
    // @ts-expect-error - virtual module provided by React Router at build time
    build: () => import("virtual:react-router/server-build"),
    getLoadContext() {
      const scopedServices = container.createScope();
      return {
        logger: scopedServices.cradle.logger,
        session: scopedServices.cradle.sessionManager,
        mainConfig: scopedServices.cradle.mainConfig,
        services: scopedServices.cradle,
        serverTimingsProfiler: scopedServices.cradle.serverTimingsProfiler,
        db: scopedServices.cradle.db,
        dbQueryClient: scopedServices.cradle.dbQueryClient,
        s3Client: scopedServices.cradle.s3Client,
        queryClient: scopedServices.cradle.queryClient,
      };
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
