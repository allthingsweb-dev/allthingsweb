import { createRequestHandler } from "@react-router/express";
import express from "express";
import morgan from "morgan";
import "react-router";
import type { MainConfig } from "~/config.server";
import { buildContainer } from "~/modules/container.server";
import { DatabaseClient } from "~/modules/db/client.server";
import { DbQueryClient } from "~/modules/db/queries.server";
import { QueryClient } from "~/modules/allthingsweb/client.server";
import type { Logger } from "~/modules/logger.server";
import { S3Client } from "~/modules/s3/client.server";
import type { ServerTimingsProfiler } from "~/modules/server-timing.server";
import type { SessionManager } from "~/modules/session/create-session-manager.server";

// TODO re-add Sentry
// node, & entry files
// import('~/modules/sentry/sentry.client');
// import('~/modules/posthog/posthog.client');

declare module "react-router" {
  export interface AppLoadContext {
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

let container = buildContainer();
const logger = container.cradle.logger;
logger.start(
  `Server timezone offset: ${new Date().getTimezoneOffset() / 60} hours`,
);

const app = express();

app.use(
  morgan("tiny", {
    stream: {
      write: (message) => {
        container.cradle.logger.info(message.trim());
      },
    },
  }),
);

app.use(
  createRequestHandler({
    // @ts-expect-error - virtual module provided by React Router at build time
    build: () => import("virtual:react-router/server-build"),
    getLoadContext() {
      const scopedServices = container.createScope();
      // here you can register the services that would be request-specific
      return {
        services: scopedServices.cradle,
        logger: scopedServices.cradle.logger,
        session: scopedServices.cradle.sessionManager,
        mainConfig: scopedServices.cradle.mainConfig,
        serverTimingsProfiler: scopedServices.cradle.serverTimingsProfiler,
        db: scopedServices.cradle.db,
        dbQueryClient: scopedServices.cradle.dbQueryClient,
        s3Client: scopedServices.cradle.s3Client,
        queryClient: scopedServices.cradle.queryClient,
      };
    },
  }),
);

export default app;
