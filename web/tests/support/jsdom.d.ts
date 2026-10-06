/**
 * The little of jsdom the axe test uses. Its own types (@types/jsdom) pull
 * in a newer @types/node whose Uint8Array clashes with Bun's.
 */
declare module "jsdom" {
  export class JSDOM {
    constructor(html: string, options?: { runScripts?: "outside-only" });
    readonly window: {
      readonly document: unknown;
      eval(code: string): unknown;
      close(): void;
    };
  }
}
