import { configSchema, server } from "better-env/config-schema";

const lumaEnvConfig = configSchema("Luma", {
  apiKey: server({
    env: "LUMA_API_KEY",
    optional: true,
  }),
  calendarApiId: server({
    env: "LUMA_CALENDAR_API_ID",
    optional: true,
  }),
  calendarHandle: server({
    env: "LUMA_CALENDAR_HANDLE",
    optional: true,
  }),
});

export const lumaConfig = {
  apiKey: lumaEnvConfig.server.apiKey,
  calendarApiId: lumaEnvConfig.server.calendarApiId,
  calendarHandle: lumaEnvConfig.server.calendarHandle,
};
