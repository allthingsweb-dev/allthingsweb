/**
 * The brand's colors (brand/all-things.tokens.json), and which one the slash
 * takes: Bridge on light grounds, Glow on Night and other dark ones.
 */

export const NIGHT = "#1B1729";
export const PAPER = "#F4F1EC";
export const INK = "#141210";
export const BRIDGE = "#C0362C";
export const GLOW = "#FF6A3D";
export const LAVENDER = "#DACFFF";
export const DUSK = "#D9D3E0";
export const VIOLET = "#5B34D6";

/**
 * The slash's color for a Claude Code theme setting (`/config`'s `theme`
 * row: `dark`, `light-daltonized`, a custom or plugin theme's id, `auto`).
 * `auto` follows the terminal: COLORFGBG's background when it says, else dark.
 */
export function slashColorOf(
  theme: unknown,
  colorFgBg: string | undefined,
): string {
  const name = typeof theme === "string" ? theme.toLowerCase() : "";
  if (/paper|light/.test(name)) return BRIDGE;
  if (/night|dark/.test(name)) return GLOW;
  return isLightTerminal(colorFgBg) ? BRIDGE : GLOW;
}

/** COLORFGBG is "fg;bg" in ANSI color numbers: 7 and 15 are light grounds. */
function isLightTerminal(colorFgBg: string | undefined): boolean {
  const background = colorFgBg?.split(";").at(-1);
  return background === "7" || background === "15";
}
