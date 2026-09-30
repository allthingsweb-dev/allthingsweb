import { authConfig } from "./auth/config";
import { cronConfig } from "./cron/config";
import { databaseConfig } from "./database/config";
import { electricConfig } from "./electric/config";
import { instanceConfig } from "./instance/config";
import { integrationsConfig } from "./integrations/config";
import { lumaConfig } from "./luma/config";
import { storageConfig } from "./storage/config";

export const mainConfig = {
  instance: instanceConfig,
  database: {
    databaseUrl: databaseConfig.databaseUrl,
    neonAuth: authConfig,
  },
  electricSQL: electricConfig,
  s3: storageConfig,
  resend: {
    apiKey: integrationsConfig.resendApiKey,
  },
  cron: cronConfig,
  luma: lumaConfig,
};

export type MainConfig = typeof mainConfig;
