/**
 * Talk descriptions to sanitize, in the spirit of OWASP's XSS filter evasion
 * cheat sheet: what editors write, then every way markup has been used to
 * smuggle script past sanitizers. core's tests run them in Bun and web's in
 * workerd; both hold the output to the app's (sanitize-html), except for the
 * divergences below, and to {@link unsafeParts}.
 */

const app = new URL("../../../app/", import.meta.url);

const { sanitizeRichText: appSanitizeRichText } = (await import(
  new URL("src/lib/safe-html.ts", app).href
)) as { sanitizeRichText: (html: string) => string };

/** The app's sanitized HTML for `html`. */
export const appSanitize = (html: string): string => appSanitizeRichText(html);

const script = "<script>alert(1)</script>";
const img = "<img src=x onerror=alert(1)>";

export const corpus: ReadonlyArray<string> = [
  // What editors write.
  "<p>One</p><p>Two</p>",
  "<P CLASS=x>Upper<BR>case</P>",
  "<ul><li>a<ul><li>nested</li></ul></li><li>b</li></ul>",
  "<ol><li>first</li></ol><blockquote>quote</blockquote><pre>  code  </pre>",
  "<p><strong>s</strong> <b>b</b> <em>e</em> <i>i</i> <u>u</u> <s>s</s> <code>c</code></p>",
  "<pre><code>const a = 1;\n  if (a &lt; 2) {}\n</code></pre>",
  "Line<br/>break<br>and<br />more",
  "<h2>Heading</h2>text   \t\n\n\n\nmore",
  "<p>Q&amp;A with the team&nbsp;&mdash; it&rsquo;s &ldquo;live&rdquo;&hellip;</p>",
  '<p><a href="https://xkcd.com/927/" target="_blank" rel="nofollow noopener ugc">xkcd</a></p>',
  '<p><a tabindex="0" href="https://vibes.site/" data-token-index="1">vibes</a></p>',
  "plain < text > with & stray marks",
  "Plain text, no markup.",
  "",
  // Links.
  '<a href="https://example.com">x</a>',
  '<a href="https://example.com" title="T" target="_self" rel="opener">x</a>',
  '<a title="only a title">x</a>',
  '<a href="">empty</a>',
  "<a href>bare</a>",
  "<a title>bare</a>",
  '<a href="/talks?x=1&amp;y=2#h">relative</a>',
  '<a href="#anchor">a</a> <a href="?q">q</a> <a href="talks">t</a>',
  '<a href="mailto:hi@allthingsweb.dev">m</a>',
  '<a href="tel:+15555555555">t</a> <a href="ftp://x.com">f</a> <a href="sms:1">s</a>',
  '<a href="//evil.com">pr</a> <a href="\\\\evil.com">bs</a> <a href="/\\evil.com">mixed</a>',
  '<a href="https://a.com" href="javascript:alert(1)">first wins</a>',
  '<a href="javascript:alert(1)" href="https://a.com">first loses</a>',
  '<a href="https://a.com" onclick="alert(1)" onmouseover=alert(1) style="color:red" class="c" id="i">attrs</a>',
  "<a><a href='https://a.com'>nested</a></a>",
  "<a href='https://a.com'><p>block in a link</p></a>",
  '<a TITLE="Up" HREF="HTTPS://X.COM">case</a>',
  '<a href="https://x.com" target="_self" rel="">rel</a>',
  '<a href="https:&#47;&#47;example.com">encoded slashes</a>',
  '<a href="https://example.com/?a=1&b=2&copy=3&copy">legacy in a URL</a>',
  // javascript: and friends.
  '<a href="javascript:alert(1)">j</a>',
  '<a href="JaVaScRiPt:alert(1)">j</a>',
  '<a href=" javascript:alert(1)">j</a>',
  '<a href="java\tscript:alert(1)">j</a>',
  '<a href="java\nscript:alert(1)">j</a>',
  '<a href="java&#09;script:alert(1)">j</a>',
  '<a href="java&#x09;script:alert(1)">j</a>',
  '<a href="java&#x0A;script:alert(1)">j</a>',
  '<a href="java&#x0D;script:alert(1)">j</a>',
  '<a href="&#14;  javascript:alert(1)">j</a>',
  '<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;&#58;alert(1)">j</a>',
  '<a href="&#0000106&#0000097&#0000118&#0000097&#0000115&#0000099&#0000114&#0000105&#0000112&#0000116&#0000058alert(1)">j</a>',
  '<a href="&#x6A&#x61&#x76&#x61&#x73&#x63&#x72&#x69&#x70&#x74&#x3A;alert(1)">j</a>',
  '<a href="javascript&#58;alert(1)">j</a>',
  '<a href="javascript&#x3a;alert(1)">j</a>',
  '<a href="javascript&colon;alert(1)">j</a>',
  '<a href="&Tab;javascript:alert(1)">j</a>',
  '<a href="java&NewLine;script:alert(1)">j</a>',
  '<a href="https&colon;//example.com">colon</a>',
  '<a href="java<!-- -->script:alert(1)">j</a>',
  '<a href="jav&#x0;ascript:alert(1)">j</a>',
  '<a href="java\u0000script:alert(1)">j</a>',
  '<a href="\u0001javascript:alert(1)">j</a>',
  '<a href="java script:alert(1)">j</a>',
  '<a href=" javascript:alert(1)">j</a>',
  '<a href="ｊａｖａｓｃｒｉｐｔ:alert(1)">j</a>',
  "<a href=javascript:alert(1)>unquoted</a>",
  "<a href=`javascript:alert(1)`>backticks</a>",
  "<a href=\"javascript:alert('XSS')\">quotes</a>",
  '<a href="vbscript:msgbox(1)">v</a> <a href="livescript:x">l</a>',
  '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">d</a>',
  '<a href="DATA:text/html,<script>alert(1)</script>">d</a>',
  '<a href="file:///etc/passwd">f</a>',
  '<a href="&#x2F;&#x2F;evil.com">pr</a>',
  '<a href="https://example.com/&notit;">prefix</a>',
  '<a href="https://exa\u0000mple.com">nul</a>',
  // Attribute injection and escaping.
  '<a href="https://ok.com" title="x" onmouseover="alert(1)">a</a>',
  '<a href="https://ok.com"title="x">no space</a>',
  '<a href=https://ok.com/"onmouseover="alert(1)">unquoted quote</a>',
  "<a title='a\"b<c>d&e'>q</a>",
  '<a title="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;">q</a>',
  '<a href="https://x.com/?q=&quot;&gt;&lt;script&gt;">x</a>',
  "<a title=`x` href=https://x.com>backtick</a>",
  '<a/href="https://x.com">slash</a>',
  '<a href="https://x.com"/onclick=alert(1)>slash</a>',
  "<a href='https://x.com' title=>empty value</a>",
  '<a "href"="javascript:1">quoted name</a>',
  '<a title="&eacute &eacute= &eacutex &amp; &copy;2026 &notit; &bigstar;">t</a>',
  // Event handlers and dangerous elements.
  img,
  "<IMG SRC=\"javascript:alert('XSS');\">",
  `<p>Typed errors<br>and services.</p>${script}${img}`,
  "<body onload=alert(1)>b</body>",
  "<svg onload=alert(1)>",
  "<svg/onload=alert(1)>",
  `<svg>${script}</svg>`,
  '<svg><a xlink:href="javascript:alert(1)"><text>t</text></a></svg>',
  "<svg><animate attributeName=href values=javascript:alert(1) /></svg>",
  `<svg><foreignObject><p>x</p>${script}</foreignObject></svg>`,
  `<svg><style>${img}</style></svg>`,
  `<svg><![CDATA[${img}]]></svg>`,
  `<svg><p><style>${img}</style></p></svg>`,
  `<math><mtext><table><mglyph><style>${img}</style></mglyph></table></mtext></math>`,
  '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  `<math><annotation-xml encoding="text/html"><style>${img}</style></annotation-xml></math>`,
  "<iframe src=javascript:alert(1)></iframe>",
  '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  `<iframe><p>fallback</p>${script}</iframe>`,
  "<iframe>unclosed <b>x</b>",
  `${"<iframe>".repeat(10)}<b>x</b>`,
  "<iframe src=x></iframe>",
  "<object data=javascript:alert(1)>o</object>",
  "<embed src=javascript:alert(1)>",
  "<form action=javascript:alert(1)><button>x</button></form>",
  "<input onfocus=alert(1) autofocus>",
  "<details open ontoggle=alert(1)><summary>s</summary></details>",
  "<video><source onerror=alert(1)></video>",
  "<marquee onstart=alert(1)>m</marquee>",
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  "<link rel=stylesheet href=javascript:alert(1)>",
  "<base href=javascript:alert(1)//>",
  "<table background=javascript:alert(1)><tr><td>cell</td></tr></table>",
  '<div style="background-image:url(javascript:alert(1))">d</div>',
  "<style>@import'javascript:alert(1)';</style>",
  '<p style="x:expression(alert(1))">e</p>',
  // Script, raw text and RCDATA.
  "<script>alert(1)</script><style>p{}</style><textarea>t</textarea><noscript>n</noscript>",
  "<scr<script>ipt>alert(1)</scr</script>ipt>",
  "<<script>alert(1)//<</script>",
  "<script/xss src=x></script>",
  "<script\n>alert(1)</script\n>",
  "<SCRIPT>alert(1)</SCRIPT><scRipt>alert(2)</scrIpt>",
  "<script>alert(1)",
  "<script><!--</script><script>alert(1)//--></script>",
  `<textarea>${script}</textarea>`,
  `<textarea></textarea>${img}`,
  `<xmp></xmp>${img}`,
  "<xmp><b>raw</b></xmp>",
  `<title>${img}</title>`,
  "<title>&lt;b&gt; &amp; t</title>",
  '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
  "<noscript><p>shown</p></noscript>",
  '<noembed><img title="</noembed><img src=x onerror=alert(1)>"></noembed>',
  "<noembed><b>raw</b> &amp;</noembed>",
  `<noframes>${script}</noframes>`,
  `<plaintext>${script}`,
  `<select><option>${img}</option></select>`,
  `<template>${script}</template>`,
  // Comments, CDATA and other declarations.
  `<!-- ${script} -->`,
  `<!-->${img}-->`,
  `<!--->${img}-->`,
  `<!-- --!>${img}`,
  `<!--[if IE]>${script}<![endif]-->`,
  `<![CDATA[${script}]]>`,
  "<xmp><b>raw</b></xmp><iframe src=x></iframe><!-- comment --><![CDATA[data]]>",
  '<?xml version="1.0"?><p>x</p>',
  "<!DOCTYPE html><p>x</p>",
  "<! foo><p>x</p>",
  '<!--<a href="--><a href=javascript:alert(1)>x</a>">',
  "<!--unterminated",
  // Character references.
  "<p>a&nbsp;b &amp; c &lt;d&gt; &quot;e&quot; &#39;f&#39; &eacute; &#x1F600;</p>",
  "<p>&amp;lt;not a tag&amp;gt; &amp;nbsp;</p>",
  "&lt;script&gt;alert(1)&lt;/script&gt;",
  "&#60;script&#62;alert(1)&#60;/script&#62;",
  "&#x3C;img src=x onerror=alert(1)&#x3E;",
  "&#0; &#xD800; &#x110000; &#128; &#x9F; &#159; &#x80;",
  "&#99999999999999; &#x0000000041; &#65 &#x42 &#",
  "&eacute &eacutex &eacute; &copy2026 &COPY; &AMP &ampx &amp",
  "&notit; &notin; &not; &not",
  "&bigstar; &colon; &Tab;",
  "&unknown; &1x; & &; &#; &#x; &#xG; &x",
  "R&D, Q&A, AT&T",
  "&lang;&rang; &apos; &euro; &zwj;&zwnj;&lrm;&rlm; &thetasym;",
  "&Eacute;&eacute; &Alpha;&alpha; &OElig; &fnof;",
  "&am<!-- -->p; &<b>amp;</b>",
  // Unicode and control characters.
  "\u0000null\u0000",
  "a\r\nb\rc",
  "﻿bom",
  "‮evil.exe‬",
  "zero​width",
  "😀 emoji",
  "<ſcript>alert(1)</ſcript>",
  "<scrİpt>alert(1)</scrİpt>",
  // Structure.
  "<p>unclosed<p>paragraphs<li>stray item",
  "<b><i>x</b>y</i>",
  "<p>a<div>b</p>c</div>",
  "<p>a<div>b</div>c</p>",
  "text</p>more",
  "</br>",
  "<ul><li>a<li>b</ul>",
  `${"<b>".repeat(40)}deep`,
  "<p><ul><li>x</li></ul></p>",
  "<blockquote><p>q</p></blockquote>",
  `<code>${script}</code>`,
  "<pre><b>x</b>\n</pre>",
  "<h1>t</h1><h2>u</h2>",
  "<table><tr><td>cell</td></tr></table>",
  "<p/>x",
  "<p>x</P >",
  "<p\n>x</p\n>",
  "<p<b>x</b>",
  "< p>not a tag</ p>",
  "<>empty<>",
  "<3 love",
  "a < b > c",
  "<a <b>x</b>",
  "<p",
  '<p title="unterminated',
  "<form><form><p>x</p></form></form>",
  "<image src=x>i</image>",
];

// Why each divergence is harmless.
const passedThrough =
  "A named reference outside HTML 4.01 is kept as written, for the browser to decode as the app's decoder does: it shows the same text, and only ever text.";
const refusedLink =
  "A URL holding a named reference outside HTML 4.01 is refused, since the reference could spell part of a scheme; the link keeps its text.";
const strayEndTag =
  "lol-html reports end tags only for elements it has open, so an end tag that closes nothing is lost; htmlparser2, as browsers do, makes an empty paragraph of a stray </p> and a line break of </br>. Formatting is lost, never content.";

/**
 * Inputs where this sanitizer's output differs from the app's, with why the
 * difference is harmless. Every output here still passes {@link unsafeParts}.
 */
export const divergences: ReadonlyMap<
  string,
  { readonly html: string; readonly why: string }
> = new Map([
  [
    '<a href="https&colon;//example.com">colon</a>',
    {
      html: '<a target="_blank" rel="noopener noreferrer">colon</a>',
      why: refusedLink,
    },
  ],
  [
    '<a href="https://example.com/&notit;">prefix</a>',
    {
      html: '<a target="_blank" rel="noopener noreferrer">prefix</a>',
      why: refusedLink,
    },
  ],
  [
    '<a title="&eacute &eacute= &eacutex &amp; &copy;2026 &notit; &bigstar;">t</a>',
    {
      html: '<a title="é &amp;eacute= &amp;eacutex &amp; ©2026 &notit; &bigstar;" target="_blank" rel="noopener noreferrer">t</a>',
      why: passedThrough,
    },
  ],
  ["&notit; &notin; &not; &not", { html: "&notit; ∉ ¬ ¬", why: passedThrough }],
  [
    "&bigstar; &colon; &Tab;",
    { html: "&bigstar; &colon; &Tab;", why: passedThrough },
  ],
  [
    "&unknown; &1x; & &; &#; &#x; &#xG; &x",
    {
      html: "&unknown; &amp;1x; &amp; &amp;; &amp;#; &amp;#x; &amp;#xG; &amp;x",
      why: passedThrough,
    },
  ],
  [
    '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
    {
      html: '"&gt;',
      why: "Browsers read noscript's content as raw text up to </noscript>, which ends it inside the title; htmlparser2 reads it as markup. What follows is text.",
    },
  ],
  [
    `<![CDATA[${script}]]>`,
    {
      html: "alert(1)]]&gt;",
      why: "Outside SVG and MathML, browsers read <![CDATA[ as a comment that ends at the first >; htmlparser2 reads on to ]]>. What follows is text.",
    },
  ],
  [
    `${"<iframe>".repeat(10)}<b>x</b>`,
    {
      html: "&lt;iframe&gt;&lt;b&gt;x&lt;/b&gt;",
      why: "An iframe's fallback content is sanitized again, as the app does, but only eight levels deep; below that it is kept as text.",
    },
  ],
  ["text</p>more", { html: "textmore", why: strayEndTag }],
  ["</br>", { html: "", why: strayEndTag }],
  [
    "<p",
    {
      html: "",
      why: "Browsers drop a tag the input ends inside of; htmlparser2 keeps its name as text.",
    },
  ],
]);

/** The output the sanitizer must give for `html`. */
export const expectedSanitized = (html: string): string =>
  divergences.get(html)?.html ?? appSanitize(html);

const allowedTags = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "a",
]);
const linkAttributes = new Set(["href", "title", "target", "rel"]);

/**
 * What in sanitized `html` could do more than show formatted text and safe
 * links, if anything, judged without the sanitizer's code: its text may hold
 * no markup, its tags must be allowed ones as the sanitizer writes them, and
 * its links must open http, https or mailto URLs, or relative ones, in a new
 * tab without access to the page.
 */
export function unsafeParts(html: string): Array<string> {
  const problems: Array<string> = [];
  for (const [part] of html.matchAll(/<[^>]*>|[^<]+|</g)) {
    if (!part.startsWith("<")) {
      if (part.includes(">")) problems.push(`">" in text: ${part}`);
      for (const [entity] of part.matchAll(/&[^;]*;?/g)) {
        if (!/^&(?:amp|lt|gt|[A-Za-z][A-Za-z0-9]*);$/.test(entity)) {
          problems.push(`bare "&" in text: ${entity}`);
        }
      }
      continue;
    }
    const tag = /^<(\/?)([a-z]+)((?: [a-z]+="[^"<>]*")*)( \/)?>$/.exec(part);
    const [, end, name = "", attributes = "", selfClosing] = tag ?? [];
    if (tag === null || !allowedTags.has(name)) {
      problems.push(`not an allowed tag: ${part}`);
      continue;
    }
    if (selfClosing !== undefined && (name !== "br" || end !== "")) {
      problems.push(`self-closing: ${part}`);
    }
    if (name !== "a" || end !== "") {
      if (attributes !== "") problems.push(`attributes on ${name}: ${part}`);
      continue;
    }
    const values = new Map(
      [...attributes.matchAll(/ ([a-z]+)="([^"]*)"/g)].map(
        ([, attribute = "", value = ""]) => [attribute, value] as const,
      ),
    );
    for (const attribute of values.keys()) {
      if (!linkAttributes.has(attribute)) {
        problems.push(`link attribute ${attribute}: ${part}`);
      }
    }
    if (values.get("target") !== "_blank") problems.push(`target: ${part}`);
    if (values.get("rel") !== "noopener noreferrer") {
      problems.push(`rel: ${part}`);
    }
    const href = values.get("href");
    if (href !== undefined && !safeHref(href)) problems.push(`href: ${part}`);
  }
  return problems;
}

/** Whether an escaped href opens an allowed URL, however a browser reads it. */
function safeHref(escaped: string): boolean {
  if (/&(?!amp;|lt;|gt;|quot;)/.test(escaped)) return false;
  const href = escaped
    .replace(/&(?:lt|gt|quot);/g, (entity) =>
      entity === "&lt;" ? "<" : entity === "&gt;" ? ">" : '"',
    )
    .replace(/&amp;/g, "&");
  // Without C0 controls and spaces anywhere, more than browsers skip, so
  // none of them can hide a scheme.
  const visible = Array.from(href)
    .filter((character) => character > " ")
    .join("");
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(visible)?.[1];
  if (scheme === undefined) return !/^[/\\]{2}/.test(visible);
  return ["http", "https", "mailto"].includes(scheme.toLowerCase());
}

/**
 * What the HTML tokenizer browsers use (lol-html's) finds in `html` besides
 * text and allowed markup: elements other than the allowed ones, attributes
 * other than a link's, comments and doctypes.
 */
export async function markupProblems(html: string): Promise<Array<string>> {
  const problems: Array<string> = [];
  await new HTMLRewriter()
    .on("*", {
      element(element) {
        const allowed = element.tagName === "a" ? linkAttributes : new Set();
        if (!allowedTags.has(element.tagName)) {
          problems.push(`element ${element.tagName}`);
        }
        for (const [name] of element.attributes) {
          if (!allowed.has(name)) {
            problems.push(`attribute ${name} on ${element.tagName}`);
          }
        }
      },
    })
    .onDocument({
      comments: (comment) => void problems.push(`comment ${comment.text}`),
      doctype: () => void problems.push("doctype"),
    })
    .transform(new Response(html))
    .arrayBuffer();
  return problems;
}
