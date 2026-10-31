import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { GraphData, GraphNode } from "./api";

const W = 1000;
const H = 640;
const DRAG_THRESHOLD = 4; // px of movement before a press counts as a drag rather than a click

type SimNode = SimulationNodeDatum & GraphNode & { r: number };
type SimLink = SimulationLinkDatum<SimNode>;

const radius = (backlinks: number) => Math.min(6 + 3 * Math.sqrt(backlinks), 24);

/** Golden-angle hues give any number of projects well-separated colors; mid lightness reads in light and dark. */
const projectColor = (index: number) => `hsl(${Math.round((index * 137.508) % 360)} 62% 52%)`;

const muted = "text-zinc-500 dark:text-zinc-400";
const panel = "rounded-lg border border-zinc-200 dark:border-zinc-800";

/** Hover label sits above the node, flipping below it near the top edge so it never clips. */
function labelTransform(n: SimNode): string {
  const x = n.x ?? 0;
  const y = n.y ?? 0;
  const above = y - n.r - 8;
  return `translate(${Math.max(60, Math.min(W - 60, x))} ${above < 16 ? y + n.r + 18 : above})`;
}

/**
 * Force-directed graph: d3-force owns the physics, React owns the DOM. Positions are written straight to
 * the SVG elements on each tick (no React re-render per frame), which keeps a few hundred nodes smooth.
 * React re-renders only when the data, the filter, or the hovered node changes.
 */
export function Graph({ data, onOpen }: { data: GraphData; onOpen: (id: string) => void }) {
  const [hiddenProjects, setHiddenProjects] = useState<Set<string>>(new Set());
  const [tag, setTag] = useState("");
  const [hover, setHover] = useState<string | null>(null);

  const projects = useMemo(() => [...new Set(data.nodes.map((n) => n.project))].sort(), [data]);
  const tags = useMemo(() => [...new Set(data.nodes.flatMap((n) => n.tags))].sort(), [data]);
  // Colors are keyed on the full project list, so hiding a project never recolors the others.
  const color = useMemo(() => new Map(projects.map((p, i) => [p, projectColor(i)])), [projects]);

  const { nodes, edges } = useMemo(() => {
    const keep = new Set(
      data.nodes.filter((n) => !hiddenProjects.has(n.project) && (!tag || n.tags.includes(tag))).map((n) => n.id),
    );
    return {
      nodes: data.nodes.filter((n) => keep.has(n.id)),
      edges: data.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
    };
  }, [data, hiddenProjects, tag]);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      const set = map.get(a) ?? new Set<string>();
      set.add(b);
      map.set(a, set);
    };
    for (const { source, target } of edges) {
      add(source, target);
      add(target, source);
    }
    return map;
  }, [edges]);

  const svgRef = useRef<SVGSVGElement>(null);
  const nodeEls = useRef(new Map<string, SVGCircleElement>());
  const lineEls = useRef<(SVGLineElement | null)[]>([]);
  const labelRef = useRef<SVGGElement>(null);
  const hoverRef = useRef<string | null>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const simNodes = useRef(new Map<string, SimNode>());
  const lastPos = useRef(new Map<string, { x: number; y: number }>()); // survives filter changes so the layout doesn't jump
  const drag = useRef<{ id: string; sx: number; sy: number; moved: boolean } | null>(null);

  hoverRef.current = hover;

  useEffect(() => {
    const sn: SimNode[] = nodes.map((n) => ({ ...n, r: radius(n.backlinks), ...lastPos.current.get(n.id) }));
    const byId = new Map(sn.map((n) => [n.id, n]));
    simNodes.current = byId;
    const links: SimLink[] = edges.map((e) => ({ source: e.source, target: e.target }));
    const sim = forceSimulation<SimNode>(sn)
      .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(60).strength(0.6))
      .force("charge", forceManyBody<SimNode>().strength(-140).distanceMax(320))
      .force("collide", forceCollide<SimNode>((d) => d.r + 3))
      .force("center", forceCenter(W / 2, H / 2))
      // Gentle pull keeps disconnected notes (and small islands) on screen instead of drifting away.
      .force("x", forceX<SimNode>(W / 2).strength(0.04))
      .force("y", forceY<SimNode>(H / 2).strength(0.06));

    const clamp = (v: number, r: number, max: number) => Math.max(r, Math.min(max - r, v));
    const paint = () => {
      for (const n of sn) {
        n.x = clamp(n.x ?? W / 2, n.r, W);
        n.y = clamp(n.y ?? H / 2, n.r, H);
        lastPos.current.set(n.id, { x: n.x, y: n.y });
        const el = nodeEls.current.get(n.id);
        if (el) {
          el.setAttribute("cx", n.x.toFixed(1));
          el.setAttribute("cy", n.y.toFixed(1));
        }
      }
      links.forEach((l, i) => {
        const el = lineEls.current[i];
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        if (!el) return;
        el.setAttribute("x1", (s.x ?? 0).toFixed(1));
        el.setAttribute("y1", (s.y ?? 0).toFixed(1));
        el.setAttribute("x2", (t.x ?? 0).toFixed(1));
        el.setAttribute("y2", (t.y ?? 0).toFixed(1));
      });
      const h = hoverRef.current ? byId.get(hoverRef.current) : undefined;
      if (h && labelRef.current) labelRef.current.setAttribute("transform", labelTransform(h));
    };

    // Settle off-screen first so the first paint is already a sensible layout, not a scramble.
    sim.stop();
    const warm = lastPos.current.size ? 60 : 200;
    for (let i = 0; i < warm; i++) sim.tick();
    paint();

    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      sim.alpha(0.2).on("tick", paint).restart();
    }
    simRef.current = sim;
    return () => {
      sim.stop();
      sim.on("tick", null);
      simRef.current = null;
    };
  }, [nodes, edges]);

  // Place the hover label as soon as hover changes (the tick loop may already be asleep).
  useEffect(() => {
    const h = hover ? simNodes.current.get(hover) : undefined;
    if (h && labelRef.current) labelRef.current.setAttribute("transform", labelTransform(h));
  }, [hover]);

  const toSvg = (e: PointerEvent) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : pt;
  };

  const onDown = (e: PointerEvent<SVGCircleElement>, id: string) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, sx: e.clientX, sy: e.clientY, moved: false };
  };
  const onMove = (e: PointerEvent<SVGCircleElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_THRESHOLD) return;
    d.moved = true;
    const n = simNodes.current.get(d.id);
    if (!n) return;
    const p = toSvg(e);
    n.fx = p.x;
    n.fy = p.y;
    simRef.current?.alphaTarget(0.25).restart();
  };
  const onUp = (e: PointerEvent<SVGCircleElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const n = simNodes.current.get(d.id);
    if (n) {
      n.fx = null;
      n.fy = null;
    }
    simRef.current?.alphaTarget(0);
    if (!d.moved && e.type === "pointerup") onOpen(d.id);
  };

  const hovered = hover ? nodes.find((n) => n.id === hover) : undefined;
  const near = hover ? neighbors.get(hover) : undefined;
  const dim = (id: string) => (hover && id !== hover && !near?.has(id) ? 0.18 : 1);

  const toggleProject = (p: string) =>
    setHiddenProjects((prev) => {
      const next = new Set(prev);
      if (!next.delete(p)) next.add(p);
      return next;
    });

  if (data.nodes.length === 0) return <p className={muted}>This vault has no notes yet, so there is nothing to graph.</p>;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filter graph by project">
        {projects.map((p) => {
          const off = hiddenProjects.has(p);
          return (
            <button
              key={p}
              type="button"
              aria-pressed={!off}
              onClick={() => toggleProject(p)}
              className={`${panel} flex items-center gap-2 px-2.5 py-1 text-sm ${off ? "opacity-50" : ""}`}
            >
              <span className="inline-block h-3 w-3 rounded-full" style={{ background: color.get(p) }} />
              {p}
            </button>
          );
        })}
        {tags.length > 0 && (
          <select
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            aria-label="Filter graph by tag"
            className={`${panel} ml-auto bg-transparent px-2 py-1 text-sm`}
          >
            <option value="">All tags</option>
            {tags.map((t) => (
              <option key={t} value={t} className="text-zinc-900">
                {t}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className={`${panel} relative overflow-hidden`}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="group"
          aria-label={`Note graph: ${nodes.length} notes, ${edges.length} links`}
          className="block h-auto w-full touch-none select-none"
        >
          <g stroke="currentColor" className="text-zinc-400 dark:text-zinc-600" strokeWidth={1.2}>
            {edges.map((e, i) => (
              <line
                key={`${e.source}>${e.target}`}
                ref={(el) => {
                  lineEls.current[i] = el;
                }}
                opacity={hover ? (e.source === hover || e.target === hover ? 0.9 : 0.08) : 0.55}
              />
            ))}
          </g>
          <g>
            {nodes.map((n) => (
              <circle
                key={n.id}
                ref={(el) => {
                  if (el) nodeEls.current.set(n.id, el);
                  else nodeEls.current.delete(n.id);
                }}
                r={radius(n.backlinks)}
                fill={color.get(n.project)}
                opacity={dim(n.id)}
                stroke={n.status === "conflict" ? "#f59e0b" : "currentColor"}
                strokeWidth={n.status === "conflict" ? 3 : 1}
                className={`cursor-pointer outline-none ${n.status === "conflict" ? "" : "text-white dark:text-zinc-950"}`}
                role="link"
                tabIndex={0}
                aria-label={`${n.title} (${n.project}, ${n.backlinks} backlinks)`}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                onFocus={() => setHover(n.id)}
                onBlur={() => setHover((h) => (h === n.id ? null : h))}
                onPointerDown={(e) => onDown(e, n.id)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onKeyDown={(e) => e.key === "Enter" && onOpen(n.id)}
              />
            ))}
          </g>
          {hovered && (
            <g ref={labelRef} pointerEvents="none">
              <text
                textAnchor="middle"
                fontSize={15}
                fontWeight={600}
                strokeWidth={4}
                paintOrder="stroke"
                className="fill-zinc-900 stroke-white dark:fill-zinc-100 dark:stroke-zinc-950"
              >
                {hovered.title}
              </text>
            </g>
          )}
        </svg>
        {nodes.length === 0 && (
          <p className={`absolute inset-0 grid place-items-center text-sm ${muted}`}>No notes match this filter.</p>
        )}
      </div>
      <p className={`mt-2 text-xs ${muted}`}>
        {nodes.length} notes, {edges.length} links. Node size is backlink count; an amber ring marks a conflict. Click a
        note to open it, drag to rearrange.
      </p>
    </div>
  );
}
