/* eslint no-console: 0 */
import type { Schema, ZodTypeDef } from 'zod';
import { z } from 'zod';

export const validateConfigOrExit = <T, I>(schema: Schema<T, ZodTypeDef, I>, intent: I): T => {
  try {
    const config = schema.parse(intent);
    return config;
  } catch (exception: any) {
    if (exception instanceof z.ZodError) {
      console.error('Configuration validation failed. Exit is forced.');
      exception.issues.forEach((issue) => {
        console.error(`\t- issue: ${issue.path.join('.')}: ${issue.message}`);
      });
    } else {
      console.error(exception);
    }
    process.exit(1);
  }
};
