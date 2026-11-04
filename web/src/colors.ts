/**
 * Project hues are the only saturated color in the UI. The five flagship projects get the hand-curated
 * "quiet observatory" palette; any other project falls back to a golden-angle hue so an arbitrary vault
 * still gets stable, well-separated colors. Colors are keyed on the full sorted project list, so hiding
 * or spotlighting a project never recolors the others.
 */
const PALETTE: Record<string, string> = {
  memex: "#b18cff",
  agenttrace: "#3ddc97",
  agentprobe: "#fb7185",
  "mcp-firewall": "#22d3ee",
  wikey: "#fb923c",
};

export function projectColors(projects: Iterable<string>): Map<string, string> {
  const sorted = [...new Set(projects)].sort();
  const map = new Map<string, string>();
  let fallback = 0;
  for (const p of sorted) {
    if (PALETTE[p]) map.set(p, PALETTE[p]);
    else map.set(p, `hsl(${Math.round((fallback++ * 137.508) % 360)} 60% 60%)`);
  }
  return map;
}

export const CONFLICT_COLOR = "#fbbf24";
