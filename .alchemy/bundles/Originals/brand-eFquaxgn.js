import{a as e,i as t,n,o as r,s as i,t as a}from"./tokens-DSaIjgz9.js";import{F as o,I as s,L as c,M as l,N as u,P as d,h as f,m as p,n as m,t as h,v as g}from"./document-CRt9WkVL.js";import{n as _}from"./rolldown-runtime-ah0OpeJ9.js";function rgb(e){let t=/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(e);if(t===null)throw Error(`Expected #RRGGBB, got ${e}`);let channel=e=>Number.parseInt(e??``,16);return[channel(t[1]),channel(t[2]),channel(t[3])]}function screenLuminance([e,t,n]){let linear=e=>(e/255)**2.4;return .2126729*linear(e)+.7151522*linear(t)+.072175*linear(n)}function apcaContrast(e,t){let n=softClamp(screenLuminance(rgb(e))),r=softClamp(screenLuminance(rgb(t)));if(Math.abs(r-n)<5e-4)return 0;let i=1.14,a=.027;if(r>n){let e=(r**.56-n**.57)*i;return e<.1?0:(e-a)*100}let o=(r**.65-n**.62)*i;return o>-.1?0:(o+a)*100}function textFloor(e){let t=Math.abs(e);if(t>=75)return`small`;if(t>=60)return`large`;if(t>=45)return`display`}function relativeLuminance([e,t,n]){let linear=e=>{let t=e/255;return t<=.04045?t/12.92:((t+.055)/1.055)**2.4};return .2126*linear(e)+.7152*linear(t)+.0722*linear(n)}function wcagContrast(e,t){let[n,r]=[relativeLuminance(rgb(e)),relativeLuminance(rgb(t))].toSorted((e,t)=>t-e);return((n??0)+.05)/((r??0)+.05)}var v,y,softClamp;function init_contrast(){return(init_contrast=_(()=>{v=.022,y=1.414,softClamp=e=>e>v?e:e+(v-e)**y}))()}var b;function init_foundations(){return(init_foundations=_(()=>{b={html:`<h2>all things/_ — brand foundations</h2>
<p>The rules every page, cover, slide, email and line of copy is checked against. Design tokens, components and templates implement these; when they disagree, this document wins and they get fixed.</p>
<h3>Who we are</h3>
<p><strong>An open door and a high bar.</strong> All Things is an open community for people who build software in San Francisco: the person a month into their first job, the maintainer of a library you install every day, the founder, the creator, and everyone between. Everyone is welcome. What goes on stage has earned its place.</p>
<blockquote>
<p>Evenings for people who build software.
In the neighborhoods of San Francisco.</p>
</blockquote>
<p>These two sentences are the whole pitch. They support the page; they never headline it.</p>
<h3>Name</h3>
<ul>
<li>The name is <strong>all things</strong>, always lowercase. The master wordmark is <strong>all things/_</strong>: the slot after the slash is left open, and every event fills it.</li>
<li>Each event is <strong>all things/&lt;topic&gt;</strong>: all things/effect, all things/expo. The topic is lowercase, short and specific.</li>
<li>&quot;all things&quot; abbreviates to <strong>at</strong>. Lists and running copy use <strong>at/&lt;topic&gt;</strong> (at/effect, at/react native).</li>
<li>The sign-off is <strong>see you at/&lt;topic&gt;</strong>, exactly in that form. It belongs after someone commits: the confirmation state, the calendar invite title, the reminder email subject. Never beside the button that asks.</li>
<li><strong>The cursor means &quot;not yet happened&quot;.</strong> Upcoming and live events carry a blinking _ (all things/effect_); past events lose it (all things/expo). The master wordmark always keeps it.</li>
<li>The lockup is the link. allthings.dev/effect is the address of all things/effect.</li>
<li>&quot;All Things Web&quot; is our history. It appears on the history page and in launch messaging, never in the brand.</li>
</ul>
<h3>Voice</h3>
<p>Plain, warm, specific, a little dry. We sound like the friend who knows the good events, not like an events company.</p>
<section class="scroll" aria-label="Voice" tabindex="0"><table>
<thead>
<tr>
<th>Say</th>
<th>Not</th>
</tr>
</thead>
<tbody><tr>
<td>evenings</td>
<td>events, programming</td>
</tr>
<tr>
<td>I&#39;m in</td>
<td>RSVP, Register now, Sign up</td>
</tr>
<tr>
<td>hosted at CodeRabbit · hosts</td>
<td>sponsored by, sponsors, partners</td>
</tr>
<tr>
<td>East Cut, Potrero Hill, FiDi</td>
<td>&quot;downtown SF&quot;, &quot;the Bay Area tech scene&quot;</td>
</tr>
<tr>
<td>who&#39;s on stage and what they built</td>
<td>&quot;thought leaders&quot;, &quot;industry experts&quot;</td>
</tr>
<tr>
<td>talk between evenings → discord</td>
<td>Join our vibrant community!</td>
</tr>
</tbody></table>
</section>
<ul>
<li>Hosting companies give space, food and drinks. We have never taken money or sold a stage, so we never call anyone a sponsor.</li>
<li>Say each thing once. If the page already shows the date, the button doesn&#39;t repeat it.</li>
<li>No exclamation-mark enthusiasm, no hype words, no emoji in the brand voice.</li>
</ul>
<h3>Places</h3>
<p>Every event names its neighborhood, using the name locals use. It is how we remind a tech crowd that they live in a real city.</p>
<section class="scroll" aria-label="Places" tabindex="0"><table>
<thead>
<tr>
<th>Venue</th>
<th>Neighborhood</th>
</tr>
</thead>
<tbody><tr>
<td>201 Spear St (CodeRabbit), 100 1st St (Vercel)</td>
<td>East Cut</td>
</tr>
<tr>
<td>45 Fremont St (Sentry), 351 California St (Sanity), 50 Beale St (Mux), 525 Market St (AWS GenAI Loft), 585 Market St, 660 Market St (WorkOS), 1 Post St (Mintlify)</td>
<td>FiDi</td>
</tr>
<tr>
<td>40 O&#39;Farrell St (Convene), 760 Market St (Vapi, Solv)</td>
<td>Union Square</td>
</tr>
<tr>
<td>444 De Haro St (Convex, Discord), 277 Carolina St</td>
<td>Potrero Hill</td>
</tr>
<tr>
<td>Pier 70 (Standard Deviant Brewing)</td>
<td>Dogpatch</td>
</tr>
<tr>
<td>1242 Market St</td>
<td>Mid-Market</td>
</tr>
<tr>
<td>360 Ritch St (Little Skillet)</td>
<td>SoMa</td>
</tr>
<tr>
<td>620 Treat Ave (Southern Pacific Brewing)</td>
<td>Mission</td>
</tr>
<tr>
<td>500 Terry A Francois Blvd (Cisco Meraki)</td>
<td>Mission Bay</td>
</tr>
</tbody></table>
</section>
<p>Derive new ones from the venue&#39;s address, and prefer the local name over the official district.</p>
<h3>Marks</h3>
<ul>
<li><strong>Master wordmark:</strong> all things/_ in Archivo 800 at 112% width, with the cursor blinking once a second. With reduced motion, the cursor stays solid.</li>
<li><strong>Logo and app icon:</strong> <strong>a/</strong>. The tail of the a runs into the slash: a beginning, with what comes next implied.</li>
<li>The slash is always Bridge on light grounds and Glow on Night.</li>
<li>Don&#39;t stack the letters (a/ over t/), drop the slash, set the marks in another typeface, or add effects.</li>
</ul>
<h3>Color</h3>
<p>Contrast is designed with APCA, the perceptual model being explored for WCAG 3, and every pairing must also pass WCAG 2.2 AA, which remains the standard: 4.5:1 for text and 3:1 for large text. APCA is the stricter guide in practice. WCAG 2 passes black on Glow at 6.6:1, yet it reads badly at text sizes; APCA rates it Lc 49.5, fit for headlines only. APCA targets: <strong>Lc 90</strong> preferred for body text, <strong>Lc 75</strong> minimum for small text, <strong>Lc 60</strong> at 24px and up, <strong>Lc 45</strong> for headlines and marks. The design-token tests check both.</p>
<section class="scroll" aria-label="Color" tabindex="0"><table>
<thead>
<tr>
<th>Token</th>
<th>Hex</th>
<th>On Paper</th>
<th>On Night</th>
<th>Use</th>
</tr>
</thead>
<tbody><tr>
<td>Paper</td>
<td>#F4F1EC</td>
<td>—</td>
<td>Lc 97.6 · 15.5:1</td>
<td>Light ground; text on Night</td>
</tr>
<tr>
<td>Ink</td>
<td>#141210</td>
<td>Lc 97.1 · 16.6:1</td>
<td>—</td>
<td>Text on Paper</td>
</tr>
<tr>
<td>Bridge</td>
<td>#C0362C</td>
<td>Lc 68.1 · 4.9:1</td>
<td>—</td>
<td>The slash; text only at 24px+</td>
</tr>
<tr>
<td>Bridge Deep</td>
<td>#9A2B22</td>
<td>Lc 77.3 · 6.8:1</td>
<td>—</td>
<td>Small orange text; Paper buttons</td>
</tr>
<tr>
<td>Violet</td>
<td>#5B34D6</td>
<td>Lc 75.9 · 6.4:1</td>
<td>—</td>
<td>Neighborhoods and links on Paper</td>
</tr>
<tr>
<td>Karl text</td>
<td>#5E5A55</td>
<td>Lc 75.5 · 6.1:1</td>
<td>—</td>
<td>Dates and meta on Paper</td>
</tr>
<tr>
<td>Karl</td>
<td>#E6E2DC</td>
<td>—</td>
<td>—</td>
<td>Quiet surfaces on Paper (named for the fog)</td>
</tr>
<tr>
<td>Night</td>
<td>#1B1729</td>
<td>—</td>
<td>—</td>
<td>Dark ground</td>
</tr>
<tr>
<td>Night raised</td>
<td>#242033</td>
<td>—</td>
<td>—</td>
<td>Surfaces on Night</td>
</tr>
<tr>
<td>Mist</td>
<td>#E3DCF7</td>
<td>—</td>
<td>Lc 86.3 · 13.2:1</td>
<td>Secondary text on Night</td>
</tr>
<tr>
<td>Dusk</td>
<td>#D9D3E0</td>
<td>—</td>
<td>Lc 79.9 · 11.9:1</td>
<td>Dates and meta on Night</td>
</tr>
<tr>
<td>Lavender</td>
<td>#DACFFF</td>
<td>—</td>
<td>Lc 80.0 · 11.9:1</td>
<td>Neighborhoods and links on Night</td>
</tr>
<tr>
<td>Glow</td>
<td>#FF6A3D</td>
<td>—</td>
<td>Lc 46.8 · 6.1:1</td>
<td>The slash and display at 36px+ only</td>
</tr>
</tbody></table>
</section>
<p>Buttons: white on Bridge Deep (Lc 90.3, 7.7:1) on Paper, and white on Bridge (Lc 81.7, 5.5:1) on Night. Violet fills take white text (Lc 89.0, 7.2:1).</p>
<p><strong>Night is muted and grained.</strong> A large, saturated dark ground tires the eyes and makes light text seem to glow, which readability scores don&#39;t measure. So Night keeps its violet hue at low chroma (OKLCH 0.22 / 0.035 / 293), and carries a fine, fixed grain (<a href="texture/grain.svg"><code>texture/grain.svg</code></a>) that gives it Paper&#39;s printed feel. Paper has no texture.</p>
<p><strong>The site is in the visitor&#39;s mode.</strong> Every page follows the mode the visitor chose (system, Paper or Night), and the system&#39;s until they choose; a page never switches to a mode of its own.</p>
<p><strong>An event&#39;s artwork has its mode.</strong> Evening events are Night; daytime events (hackathons, brunches) are Paper. An event&#39;s cover, link-preview card, slides and posts share its mode; its page does not. Which one is set by when it starts in San Francisco: from 5 AM up to 4 PM is daytime, and 4 PM or later (or the small hours) is an evening.</p>
<h3>Typography</h3>
<p>One family, Archivo, used at three widths, plus Geist Mono for meta.</p>
<section class="scroll" aria-label="Typography" tabindex="0"><table>
<thead>
<tr>
<th>Role</th>
<th>Size / line</th>
<th>Weight</th>
<th>Width</th>
<th>Tracking</th>
<th>Min Lc</th>
</tr>
</thead>
<tbody><tr>
<td>Wordmark</td>
<td>168 / 0.84</td>
<td>800</td>
<td>112%</td>
<td>−4.5%</td>
<td>45</td>
</tr>
<tr>
<td>Event lockup</td>
<td>72 / 0.9</td>
<td>800</td>
<td>112%</td>
<td>−4%</td>
<td>45</td>
</tr>
<tr>
<td>Label (caps)</td>
<td>40 / 1.0</td>
<td>700</td>
<td>75%</td>
<td>−1%</td>
<td>60</td>
</tr>
<tr>
<td>Lead</td>
<td>30 / 1.25</td>
<td>500</td>
<td>100%</td>
<td>−1%</td>
<td>75</td>
</tr>
<tr>
<td>Statement</td>
<td>22 / 1.3</td>
<td>500</td>
<td>100%</td>
<td>−1%</td>
<td>75</td>
</tr>
<tr>
<td>List name</td>
<td>21</td>
<td>700</td>
<td>100%</td>
<td>0</td>
<td>75</td>
</tr>
<tr>
<td>List place (caps)</td>
<td>14</td>
<td>600</td>
<td>75%</td>
<td>+6%</td>
<td>75</td>
</tr>
<tr>
<td>Body</td>
<td>18 / 1.55</td>
<td>400</td>
<td>100%</td>
<td>0</td>
<td>90</td>
</tr>
<tr>
<td>Meta (Geist Mono, caps)</td>
<td>14 / 1.5</td>
<td>500</td>
<td>—</td>
<td>+6%</td>
<td>75</td>
</tr>
</tbody></table>
</section>
<p>Each role&#39;s letters are pulled back by their face&#39;s left side bearing (brand/type-metrics.json, measured from the fonts by brand/marks), so the wordmark, a 156px lockup and a mono meta line share one visual left edge. The statement role sets the two sentences beside a page&#39;s lists, one line each at desktop widths.</p>
<p>Sizes are the largest. The wordmark, event lockup, label, lead and statement shrink on narrow screens, each down to a floor its token sets.</p>
<h3>Layout</h3>
<ul>
<li>A 12-column grid, flush left, ragged right. Rules instead of boxes; sharp corners.</li>
<li>Every length comes from the layout tokens in <a href="all-things.tokens.json"><code>all-things.tokens.json</code></a>:<ul>
<li>The page: at most 1440px wide, with a margin of 4.5% of the screen, from 16px on phones to 64px.</li>
<li>The grid: 12 columns with 24px gutters. In a ledger, each fact&#39;s label takes 3 columns and the fact the other 9.</li>
<li>Spacing on a 4px scale, three rule weights (1, 2 and 3px), portrait and tile sizes, and the breakpoints (480, 600, 768 and 1024px).</li>
<li>Reading measures: 68 characters to a line of reading copy, 36 to a lead.</li>
</ul>
</li>
<li>The site&#39;s stylesheet writes no length of its own but a 1px hairline, and em where a length follows the type (tracking, an underline&#39;s offset, inline code&#39;s size): no inline styles, no magic widths, no breakpoint of a page&#39;s own. A test fails the build on any other.</li>
<li>Reading copy keeps its measure and gives the rest of the row to what sits beside it. Speakers on a stage share the row rather than squeezing into narrow fixed columns.</li>
<li>A lineup is as dense as its evening is long (web/src/pages/lineup.ts). Up to 3 talks, each speaker gets a full card: portrait, title, links and bio. Up to 6, each talk shows its people as rows of portrait, role, name and title, and bios stay on /people. Beyond 6, as in a lightning round, one compact row per talk, with its description behind a disclosure. A panel or fireside chat always shows its people as rows; moderators and guests keep their role.</li>
<li>Every host is always seen: portraits sit side by side, never overlapping. The stylesheet has no negative margins.</li>
<li>Asymmetry is deliberate: neighboring blocks may sit on different cuts of the grid and align to different edges.</li>
<li>Lists of events: a light date, the name heavy with its slash, and the place bolder than the date but clearly secondary.</li>
<li>Home says each thing once: the next event is the hero, real photos sit beside it, and the lists below show only other events (&quot;after that&quot;, &quot;recently&quot;).</li>
</ul>
<h3>Imagery</h3>
<ul>
<li>Real photos of real people at our evenings. No AI illustrations and no stock photography.</li>
<li>Event covers are typographic: lockup, neighborhood, date, host, short link. They are generated from event data, never hand-assembled.</li>
</ul>
<h3>People and channels</h3>
<ul>
<li>Socials sit in a quiet line of words in the footer (luma · discord · youtube · github · x · bluesky · linkedin) and on the history page, never in a hero.</li>
<li>Luma and Discord are actions on home: &quot;subscribe on luma&quot; beside &quot;every evening →&quot;, and &quot;talk between evenings → discord&quot;. Every evening&#39;s index says where to follow along in the same quiet line of words as the footer, under its title: luma calendar · discord · x.</li>
<li>The organizers are visible everywhere: &quot;hosted by Erik &amp; Andre&quot; with portraits in every footer, organizers first on the people page, and &quot;your hosts&quot; beside the hosting company on every event page.</li>
<li>Everyone has a page of their own, <code>/people/&lt;slug&gt;</code>, from their name: their profile, every talk and part at our evenings and the ones we shared, and, for an organizer, every evening they hosted. Every name on the site links to it. When a name changes, so does the slug, and the old address redirects to the new one for good.</li>
</ul>
<h3>Accessibility</h3>
<p>APCA targets above for all text; never color alone to carry meaning; real buttons and links; alt text that describes the moment in a photo; the cursor stops blinking for people who prefer reduced motion.</p>
<ul>
<li>Text is set no smaller than its contrast allows: Lc 75 for small text, 60 at 24px and up, 45 at 36px and up. The palette shows a color too faint for text on a ground as a bar, not as text.</li>
<li>Every page starts with a link past the header to the page itself, and every control shows its focus.</li>
<li>The mode control is a popover. Escape or a click outside closes it, without script.</li>
<li>Long names and titles break rather than overflow, down to a 320px screen and at 200% zoom.</li>
<li>Every kind of page passes axe in the web tests, apart from the rules that need a browser. Color contrast is checked against the APCA targets above.</li>
</ul>
`}}))()}var x;function init_foundations$1(){return(init_foundations$1=_(()=>{init_foundations(),x=b}))()}function displayName(e){let t=u(e).replaceAll(`-`,` `);return t.charAt(0).toUpperCase()+t.slice(1)}function contrast(e,t){return e.hex===t.hex?[`the ground`]:[`Lc ${Math.abs(apcaContrast(e.hex,t.hex)).toFixed(1)}`,`${wcagContrast(e.hex,t.hex).toFixed(1)}:1`]}function Sample({color:e,background:t,theme:n,label:r}){return(0,S.jsxs)(`div`,{"data-theme":n,children:[(0,S.jsx)(`dt`,{class:`at-type-meta`,safe:!0,children:r}),(0,S.jsxs)(`dd`,{children:[textFloor(apcaContrast(e.hex,t.hex))===`small`||textFloor(apcaContrast(e.hex,t.hex))===`large`?(0,S.jsx)(`span`,{class:`sample-text`,"aria-hidden":`true`,children:`Aa`}):(0,S.jsx)(`span`,{class:`sample-bar`,"aria-hidden":`true`}),contrast(e,t).map(e=>(0,S.jsx)(`span`,{class:`figure`,safe:!0,children:e}))]})]})}function Palette(){return(0,S.jsxs)(`section`,{"aria-labelledby":`palette`,children:[(0,S.jsx)(`h2`,{id:`palette`,class:`section-title at-type-label`,children:`Palette`}),(0,S.jsx)(`ul`,{class:`swatches`,children:a(r).map(e=>(0,S.jsxs)(`li`,{class:`swatch at-swatch-${u(e.name)}`,children:[(0,S.jsx)(`div`,{class:`chip`}),(0,S.jsx)(`h3`,{class:`at-type-list-name`,safe:!0,children:displayName(e.name)}),(0,S.jsxs)(`p`,{class:`figure`,children:[(0,S.jsx)(`code`,{safe:!0,children:`--at-color-${u(e.name)}`}),(0,S.jsx)(`br`,{}),(0,S.jsx)(`span`,{safe:!0,children:e.hex})]}),(0,S.jsx)(`p`,{class:`use`,safe:!0,children:e.description}),(0,S.jsxs)(`dl`,{class:`samples`,children:[(0,S.jsx)(Sample,{color:e,background:C,theme:`light`,label:`on paper`}),(0,S.jsx)(Sample,{color:e,background:w,theme:`dark`,label:`on night`})]})]}))}),(0,S.jsx)(`h3`,{class:`at-type-list-name`,children:`Pairings and their targets`}),(0,S.jsx)(`section`,{class:`scroll`,"aria-label":`Pairings`,tabindex:`0`,children:(0,S.jsxs)(`table`,{class:`pairs`,children:[(0,S.jsx)(`thead`,{children:(0,S.jsxs)(`tr`,{children:[(0,S.jsx)(`th`,{scope:`col`,children:`Use`}),(0,S.jsx)(`th`,{scope:`col`,children:`Sample`}),(0,S.jsx)(`th`,{scope:`col`,children:`APCA Lc`}),(0,S.jsx)(`th`,{scope:`col`,children:`Target`}),(0,S.jsx)(`th`,{scope:`col`,children:`WCAG 2`})]})}),(0,S.jsx)(`tbody`,{children:n(r).map(e=>(0,S.jsxs)(`tr`,{children:[(0,S.jsx)(`td`,{safe:!0,children:e.use}),(0,S.jsx)(`td`,{children:(0,S.jsx)(`span`,{class:`sample sample-${textFloor(e.minLc)??`display`} at-swatch-${u(e.background.name)}`,children:(0,S.jsx)(`span`,{class:`at-swatch-${u(e.text.name)}`,safe:!0,children:`${displayName(e.text.name)} on ${displayName(e.background.name)}`})})}),(0,S.jsx)(`td`,{safe:!0,children:Math.abs(apcaContrast(e.text.hex,e.background.hex)).toFixed(1)}),(0,S.jsx)(`td`,{children:e.minLc}),(0,S.jsx)(`td`,{safe:!0,children:`${wcagContrast(e.text.hex,e.background.hex).toFixed(1)}:1`})]}))})]})})]})}function tracking(e){if(e===0)return`0`;let t=`${Math.abs(Math.round(e*1e3)/10)}%`;return e<0?`−${t}`:`+${t}`}function spec(e){return[e.family===`mono`?`${e.size} / ${e.lineHeight} · Geist Mono`:`${e.size} / ${e.lineHeight}`,String(e.weight),...e.width===void 0?[]:[e.width],tracking(e.letterSpacingEm),...e.uppercase?[`caps`]:[]].join(` · `)}function Specimen({role:e}){let t=`specimen at-type-${u(e.name)}`;switch(e.name){case`wordmark`:return(0,S.jsxs)(`p`,{class:t,children:[`all things`,(0,S.jsx)(`span`,{class:`slash`,children:`/`}),(0,S.jsx)(`span`,{class:`at-cursor`,children:`_`})]});case`eventLockup`:return(0,S.jsxs)(`p`,{class:t,children:[`all things`,(0,S.jsx)(`span`,{class:`slash`,children:`/`}),`effect`,(0,S.jsx)(`span`,{class:`at-cursor`,children:`_`})]});case`label`:return(0,S.jsx)(`p`,{class:t,children:`East Cut · CodeRabbit`});case`lead`:return(0,S.jsx)(`p`,{class:t,children:`Evenings for people who build software. In the neighborhoods of San Francisco.`});case`statement`:return(0,S.jsx)(`p`,{class:t,children:`Evenings for people who build software. In the neighborhoods of San Francisco.`});case`listName`:return(0,S.jsxs)(`p`,{class:t,children:[`at`,(0,S.jsx)(`span`,{class:`slash`,children:`/`}),`react native`]});case`listPlace`:return(0,S.jsx)(`p`,{class:`${t} place`,children:`Potrero Hill`});case`body`:return(0,S.jsx)(`p`,{class:t,children:`An open door and a high bar. Everyone who builds software is welcome; what goes on stage has earned its place.`});case`meta`:return(0,S.jsx)(`p`,{class:t,children:`09.30.26 · 5:30–8:30 PM · allthings.dev/effect`});default:return(0,S.jsx)(`p`,{class:t,safe:!0,children:e.description})}}function TypeScale(){return(0,S.jsxs)(`section`,{"aria-labelledby":`type`,children:[(0,S.jsx)(`h2`,{id:`type`,class:`section-title at-type-label`,children:`Type`}),(0,S.jsx)(`p`,{children:`One family, Archivo, at three widths, and Geist Mono for meta. Sizes are in pixels; large specimens shrink to fit narrow screens.`}),(0,S.jsx)(`div`,{class:`type-scale`,children:i(r).map(e=>(0,S.jsxs)(`div`,{class:`type-row`,children:[(0,S.jsxs)(`p`,{class:`spec at-type-meta`,children:[(0,S.jsx)(`span`,{safe:!0,children:displayName(e.name)}),(0,S.jsx)(`br`,{}),(0,S.jsx)(`span`,{safe:!0,children:spec(e)})]}),(0,S.jsx)(Specimen,{role:e})]}))})]})}function MarkTile({image:e,alt:t,caption:n,theme:r,size:i}){return(0,S.jsxs)(`figure`,{class:`mark-tile ${i}`,"data-theme":r,children:[(0,S.jsx)(`img`,{src:e.src,alt:t,width:String(e.width),height:String(e.height)}),(0,S.jsx)(`figcaption`,{class:`at-type-meta`,safe:!0,children:n})]})}function Marks(){let{marks:e}=s;return(0,S.jsxs)(`section`,{"aria-labelledby":`marks`,children:[(0,S.jsx)(`h2`,{id:`marks`,class:`section-title at-type-label`,children:`Marks`}),(0,S.jsx)(`p`,{children:`Generated as outlines by brand/marks, so they need no font. The slash is Bridge on light grounds and Glow on Night.`}),(0,S.jsxs)(`div`,{class:`marks`,children:[(0,S.jsx)(MarkTile,{image:e.wordmark,alt:`all things/_`,caption:`wordmark · paper`,theme:`light`,size:`wide`}),(0,S.jsx)(MarkTile,{image:e.wordmarkNight,alt:`all things/_`,caption:`wordmark · night`,theme:`dark`,size:`wide`}),(0,S.jsx)(MarkTile,{image:e.mark,alt:`a/`,caption:`logo · paper`,theme:`light`,size:`small`}),(0,S.jsx)(MarkTile,{image:e.markNight,alt:`a/`,caption:`logo · night`,theme:`dark`,size:`small`}),(0,S.jsx)(MarkTile,{image:e.icon,alt:`a/ on a Night tile`,caption:`app icon`,theme:`light`,size:`small`}),(0,S.jsx)(MarkTile,{image:e.favicon,alt:`a/, heavier for small sizes`,caption:`favicon`,theme:`light`,size:`small`}),(0,S.jsx)(MarkTile,{image:e.avatar,alt:`/_ on Night`,caption:`blank avatar, for people without a photo`,theme:`light`,size:`small`})]})]})}function brandContent(){if(T===void 0){let e=x.html,t=(0,S.jsxs)(S.Fragment,{children:[(0,S.jsxs)(`div`,{class:`intro`,children:[(0,S.jsx)(`p`,{class:`at-type-meta`,children:`brand · the living style guide`}),(0,S.jsxs)(`h1`,{class:`lockup at-type-event-lockup`,children:[`all things`,(0,S.jsx)(`span`,{class:`slash`,children:`/`}),`brand`]}),(0,S.jsx)(`p`,{class:`lead at-type-lead`,children:`Palette, type and marks, drawn from the tokens the site is built with. Where this page and the foundations disagree, the foundations win.`})]}),(0,S.jsx)(Palette,{}),(0,S.jsx)(TypeScale,{}),(0,S.jsx)(Marks,{}),(0,S.jsx)(`div`,{class:`prose`,children:e})]});if(typeof t!=`string`)throw Error(`/brand rendered asynchronously`);T=t}return T}function brandPage({origin:e,theme:t,portraits:n,images:r}){return h({meta:{title:f(`brand`),description:`The all things/_ brand: palette, type, marks and the rules they follow.`,path:`/brand`,image:o.brand},origin:e,theme:t,portraits:n,images:r,children:brandContent()})}var S,C,w,T;function init_brand(){return(init_brand=_(()=>{init_contrast(),l(),t(),c(),init_foundations$1(),m(),p(),d(),S=g(),C=e(r,`paper`,`ground`),w=e(r,`night`,`ground`)}))()}init_brand();export{brandPage};