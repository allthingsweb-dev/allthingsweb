import "react-router";
import { createRequestHandler } from "@react-router/express";
import express from "express";
import { MainConfig } from "~/config.server";
import { Logger } from "~/modules/logger.server";
import { ServerTimingsProfiler } from "~/modules/server-timing.server";
import { SessionManager } from "~/modules/session/create-session-manager.server";
import { DatabaseClient } from "~/modules/db/client.server";
import { DbQueryClient } from "~/modules/db/queries.server";
import { QueryClient } from "~/modules/allthingsweb/client.server";
import { S3Client } from "~/modules/s3/client.server";
import { buildContainer } from "~/modules/container.server";
import { LumaClient } from "~/modules/luma/api.server";

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
    lumaClient: LumaClient;
  }
}

export function getRemixExpressApp(
  container: ReturnType<typeof buildContainer>,
) {
  const app = express();

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
          lumaClient: scopedServices.cradle.lumaClient,
        };
      },
    }),
  );

  return app;
}
