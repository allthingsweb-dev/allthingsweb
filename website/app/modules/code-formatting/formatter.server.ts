import type { ShikiInstance } from "~/modules/shiki/shiki.server";

type Deps = {
  shikiInstance: ShikiInstance;
};

export type Formatter = ReturnType<typeof createFormatter>;

export function createFormatter({ shikiInstance }: Deps) {
  async function formatCode(code: string, language: string) {
    return shikiInstance.codeToHtml(code, language);
  }

  return {
    formatCode,
  };
}
