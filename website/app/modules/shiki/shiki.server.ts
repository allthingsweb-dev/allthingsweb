import { createHighlighterCoreSync, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";
import invariant from "tiny-invariant";

import dracula from "shiki/themes/dracula-soft.mjs";

import js from "shiki/langs/javascript.mjs";
import ts from "shiki/langs/typescript.mjs";
import markdown from "shiki/langs/markdown.mjs";
import tsx from "shiki/langs/tsx.mjs";
import bash from "shiki/langs/bash.mjs";
import jsx from "shiki/langs/jsx.mjs";
import json from "shiki/langs/json.mjs";
import tf from "shiki/langs/tf.mjs";
import css from "shiki/langs/css.mjs";
import html from "shiki/langs/html.mjs";

const supportedThemes = ["dracula-soft"] as const;
type SupportedTheme = (typeof supportedThemes)[number];

const supportedLanguages = [
  "javascript",
  "typescript",
  "markdown",
  "tsx",
  "bash",
  "jsx",
  "json",
  "tf",
  "css",
  "txt",
  "html",
] as const;
type SupportedLanguage = (typeof supportedLanguages)[number];

function isSupportedTheme(theme: string): theme is SupportedTheme {
  return supportedThemes.includes(theme as SupportedTheme);
}

function isSupportedLanguage(language: string): language is SupportedLanguage {
  return supportedLanguages.includes(language as SupportedLanguage);
}

async function initShiki(): Promise<HighlighterCore> {
  const engine = await createOnigurumaEngine(import("shiki/wasm"));
  const shiki = createHighlighterCoreSync({
    themes: [dracula],
    langs: [js, ts, markdown, tsx, bash, jsx, json, tf, css, html],
    engine,
  });
  return shiki;
}

export type ShikiInstance = ReturnType<typeof createShikiInstance>;

export function createShikiInstance() {
  let highlighterInstance: HighlighterCore | null = null;

  async function ensureHighlighter() {
    if (!highlighterInstance) {
      highlighterInstance = await initShiki();
    }
    return highlighterInstance;
  }

  async function codeToHtml(
    content: string,
    language: string,
    theme: string = "dracula-soft",
  ) {
    invariant(content, "CodeBlock must have content");
    invariant(
      isSupportedTheme(theme),
      `CodeBlock must have a supported theme but got ${theme}`,
    );
    invariant(
      isSupportedLanguage(language),
      `CodeBlock must have a supported language but got ${language}`,
    );
    const shiki = await ensureHighlighter();
    return shiki.codeToHtml(content, { lang: language, theme });
  }

  return {
    codeToHtml,
  };
}
