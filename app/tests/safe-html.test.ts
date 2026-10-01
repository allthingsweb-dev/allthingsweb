import { describe, expect, test } from "bun:test";
import { sanitizeRichText } from "../src/lib/safe-html";

describe("rich text sanitizing", () => {
  test("keeps paragraphs, lists and emphasis", () => {
    const html =
      "<p>Hello <strong>web</strong> <em>folks</em></p><ul><li>One</li></ul>";
    expect<string>(sanitizeRichText(html)).toBe(html);
  });

  test("removes scripts, styles and event handlers", () => {
    expect<string>(
      sanitizeRichText(
        '<p onclick="steal()">Hi<script>steal()</script><style>*{}</style><img src=x onerror="steal()"></p>',
      ),
    ).toBe("<p>Hi</p>");
  });

  test("drops dangerous link schemes and opens safe links in a new tab", () => {
    expect<string>(
      sanitizeRichText('<a href="javascript:steal()">bad</a>'),
    ).toBe('<a target="_blank" rel="noopener noreferrer">bad</a>');
    expect<string>(
      sanitizeRichText('<a href="https://allthingsweb.dev">ok</a>'),
    ).toBe(
      '<a href="https://allthingsweb.dev" target="_blank" rel="noopener noreferrer">ok</a>',
    );
  });
});
