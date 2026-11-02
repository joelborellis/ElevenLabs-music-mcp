/**
 * A stable hue per style, derived from its genre, so the Style strip has
 * visual rhythm without artwork. Same genre family → same hue, so "Indie Dance"
 * and "Indie Folk" sit together; the saturation/lightness are tuned to read in
 * both Fluent light and dark themes as a tinted surface + an accent stripe.
 */
const FAMILIES: Array<[RegExp, number]> = [
  [/hip.?hop|trap|rap/i, 275],
  [/electro|edm|house|techno|synth|dance|disco/i, 200],
  [/rock|punk|metal|grunge/i, 10],
  [/indie|alt/i, 160],
  [/pop/i, 330],
  [/jazz|soul|r&b|rnb|funk/i, 35],
  [/folk|acoustic|country|americana/i, 80],
  [/cinematic|orchestral|epic|score|classical/i, 240],
  [/ambient|lo-?fi|chill|meditation|sleep/i, 185],
  [/latin|reggaeton|afro|punjabi|bhangra|world/i, 20],
];

function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

export function hueFor(style: { name?: string | null; primary_genre?: string | null; tags?: string[] }): number {
  const haystack = [style.primary_genre, ...(style.tags ?? []), style.name].filter(Boolean).join(" ");
  for (const [pattern, hue] of FAMILIES) if (pattern.test(haystack)) return hue;
  return hash(haystack || "style") % 360;
}

export function styleSurface(hue: number, dark: boolean): { background: string; accent: string } {
  return {
    background: dark ? `hsl(${hue} 45% 22%)` : `hsl(${hue} 70% 94%)`,
    accent: dark ? `hsl(${hue} 70% 65%)` : `hsl(${hue} 65% 42%)`,
  };
}
