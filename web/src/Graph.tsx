import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import type { Simulation, SimulationLinkDatum, SimulationNodeDatum } from "d3-force";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { GraphData, GraphNode } from "./api";
import { CONFLICT_COLOR, projectColors } from "./colors";
import { Icon } from "./icons";

type SimNode = SimulationNodeDatum & GraphNode & { r: number };
type SimLink = SimulationLinkDatum<SimNode> & { proj: string };

type LabelMode = "auto" | "all" | "focus";
type Badge = "title" | "id" | "project" | "backlinks";

const DRAG_THRESHOLD = 4;
const AUTO_LABEL_LIMIT = 18;
const radius = (backlinks: number) => Math.min(7 + 3.1 * Math.sqrt(backlinks), 26);

const SPACING_LABEL = (sp: number) =>
  sp <= 0.7 ? "Tight" : sp <= 0.9 ? "Snug" : sp <= 1.1 ? "Normal" : sp <= 1.5 ? "Open" : sp <= 1.9 ? "Airy" : "Wide";

const LABEL_HINT: Record<LabelMode, string> = {
  auto: "Auto shows every label while the graph is small, then switches to hover & selection as it grows.",
  all: "Every node is labelled. Overlapping labels offset with a leader line back to their node.",
  focus: "Labels appear only on hover and for pinned (selected) notes — calmest for a dense graph.",
};

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The graph is the centerpiece. d3-force owns the physics; React owns the DOM and the control rail. Positions
 * and per-node styling are written straight to the SVG on each tick (no React re-render per frame). Zoom/pan is a
 * transform on the node + edge groups; labels live in an untransformed group so they stay a constant screen size
 * with halos and leader lines. Spotlight dims other projects IN PLACE (no reflow); the eye hides/relaxes layout.
 */
export function Graph({ data, onOpen }: { data: GraphData; onOpen: (id: string) => void }) {
  const [labelMode, setLabelMode] = useState<LabelMode>("auto");
  const [badge, setBadge] = useState<Badge>("title");
  const [spotlight, setSpotlight] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<string | null>(null);
  const [spacing, setSpacing] = useState(1);
  const [zoomPct, setZoomPct] = useState(100);

  const allProjects = useMemo(() => [...new Set(data.nodes.map((n) => n.project))].sort(), [data]);
  const color = useMemo(() => projectColors(allProjects), [allProjects]);
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data]);

  const { nodes, edges } = useMemo(() => {
    const keep = new Set(data.nodes.filter((n) => !hidden.has(n.project)).map((n) => n.id));
    return {
      nodes: data.nodes.filter((n) => keep.has(n.id)),
      edges: data.edges.filter((e) => keep.has(e.source) && keep.has(e.target)),
    };
  }, [data, hidden]);

  // Refs the imperative paint() reads, so it always sees current state without rebuilding the sim.
  const labelModeRef = useRef(labelMode); labelModeRef.current = labelMode;
  const badgeRef = useRef(badge); badgeRef.current = badge;
  const spotlightRef = useRef(spotlight); spotlightRef.current = spotlight;
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const hoverRef = useRef(hover); hoverRef.current = hover;
  const spacingRef = useRef(spacing); spacingRef.current = spacing;

  const svgRef = useRef<SVGSVGElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const edgesGRef = useRef<SVGGElement>(null);
  const nodesGRef = useRef<SVGGElement>(null);
  const circleEls = useRef(new Map<string, SVGCircleElement>());
  const lineEls = useRef<(SVGLineElement | null)[]>([]);
  const labelEls = useRef(new Map<string, { g: SVGGElement; lead: SVGLineElement; pill: SVGRectElement; text: SVGTextElement }>());

  const T = useRef({ k: 1, tx: 0, ty: 0 });
  const size = useRef({ w: 1000, h: 640 });
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const simNodes = useRef(new Map<string, SimNode>());
  const lastPos = useRef(new Map<string, { x: number; y: number }>());
  const drag = useRef<{ id: string; moved: boolean; px: number; py: number } | null>(null);
  const pan = useRef<{ px: number; py: number; tx: number; ty: number; moved: boolean } | null>(null);
  const paintRef = useRef<() => void>(() => {});

  const badgeText = (n: SimNode): string =>
    badgeRef.current === "id" ? n.id
      : badgeRef.current === "project" ? n.project
        : badgeRef.current === "backlinks" ? `${n.backlinks} ⟵`
          : n.title;

  const labelSet = (list: SimNode[]): Set<string> => {
    const show = new Set<string>(selectedRef.current);
    if (hoverRef.current) show.add(hoverRef.current);
    if (labelModeRef.current === "all" || (labelModeRef.current === "auto" && list.length <= AUTO_LABEL_LIMIT)) {
      for (const n of list) show.add(n.id);
    }
    return show;
  };

  // Build (or rebuild) the simulation whenever the visible node/edge set changes.
  useEffect(() => {
    const stage = stageRef.current;
    if (stage) {
      const r = stage.getBoundingClientRect();
      size.current = { w: Math.max(320, r.width), h: Math.max(360, r.height) };
    }
    const { w: W, h: H } = size.current;
    svgRef.current?.setAttribute("viewBox", `0 0 ${W} ${H}`);

    const sn: SimNode[] = nodes.map((n) => ({ ...n, r: radius(n.backlinks), ...lastPos.current.get(n.id) }));
    const map = new Map(sn.map((n) => [n.id, n]));
    simNodes.current = map;
    const links: SimLink[] = edges.map((e) => ({ source: e.source, target: e.target, proj: byId.get(e.source)?.project ?? "" }));

    const sp = spacingRef.current;
    const sim = forceSimulation<SimNode>(sn)
      .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(55 * sp).strength(0.5))
      .force("charge", forceManyBody<SimNode>().strength(-150 * sp).distanceMax(420))
      .force("collide", forceCollide<SimNode>((d) => d.r + 4 + 6 * sp))
      .force("center", forceCenter(W / 2, H / 2))
      .force("x", forceX<SimNode>(W / 2).strength(0.05 / sp))
      .force("y", forceY<SimNode>(H / 2).strength(0.07 / sp));

    const applyTransform = () => {
      const { k, tx, ty } = T.current;
      const t = `translate(${tx} ${ty}) scale(${k})`;
      edgesGRef.current?.setAttribute("transform", t);
      nodesGRef.current?.setAttribute("transform", t);
      setZoomPct(Math.round(k * 100));
    };

    const paint = () => {
      const { k, tx, ty } = T.current;
      const spot = spotlightRef.current, sel = selectedRef.current, hov = hoverRef.current;
      const near = new Set<string>();
      if (hov) for (const l of links) {
        const s = (l.source as SimNode).id, t = (l.target as SimNode).id;
        if (s === hov) near.add(t); if (t === hov) near.add(s);
      }
      const active = (n: SimNode) =>
        spot ? n.project === spot : sel.size ? sel.has(n.id) || hov === n.id : hov ? n.id === hov || near.has(n.id) : true;

      for (const n of sn) {
        const el = circleEls.current.get(n.id);
        const g = el?.parentNode as SVGGElement | null;
        if (g) g.setAttribute("transform", `translate(${(n.x ?? 0).toFixed(1)} ${(n.y ?? 0).toFixed(1)})`);
        if (!el) continue;
        const on = active(n), seld = sel.has(n.id);
        el.setAttribute("fill", color.get(n.project) ?? "#888");
        el.setAttribute("opacity", on ? "1" : spot ? "0.16" : "0.2");
        el.setAttribute("r", (n.r * (hov === n.id || seld ? 1.18 : 1)).toFixed(1));
        if (n.status === "conflict") {
          el.setAttribute("stroke", CONFLICT_COLOR);
          el.setAttribute("stroke-width", seld ? "3.4" : "2.6");
        } else {
          el.setAttribute("stroke", seld ? "var(--fg)" : "rgba(255,255,255,.5)");
          el.setAttribute("stroke-width", seld ? "2.4" : "1");
        }
      }
      links.forEach((l, i) => {
        const el = lineEls.current[i];
        if (!el) return;
        const s = l.source as SimNode, t = l.target as SimNode;
        el.setAttribute("x1", (s.x ?? 0).toFixed(1)); el.setAttribute("y1", (s.y ?? 0).toFixed(1));
        el.setAttribute("x2", (t.x ?? 0).toFixed(1)); el.setAttribute("y2", (t.y ?? 0).toFixed(1));
        let o = 0.14, bright = false;
        if (spot) { bright = l.proj === spot; o = bright ? 0.7 : 0.05; }
        else if (sel.size) { bright = sel.has(s.id) || sel.has(t.id); o = bright ? 0.65 : 0.06; }
        else if (hov) { bright = s.id === hov || t.id === hov; o = bright ? 0.8 : 0.05; }
        el.setAttribute("stroke", color.get(l.proj) ?? "#888");
        el.setAttribute("stroke-opacity", String(o));
        el.setAttribute("stroke-width", bright ? "1.9" : "1.2");
      });

      // labels: constant screen size, decluttered vertically, leader line when nudged off the node
      const show = labelSet(sn);
      const boxes: { n: SimNode; px: number; py: number; w: number; h: number; rr: number; lx: number; ly: number }[] = [];
      for (const n of sn) {
        const L = labelEls.current.get(n.id);
        if (!L) continue;
        if (!show.has(n.id)) { L.g.style.display = "none"; continue; }
        L.g.style.display = "";
        const px = tx + k * (n.x ?? 0), py = ty + k * (n.y ?? 0);
        const txt = badgeText(n);
        L.text.textContent = txt;
        boxes.push({ n, px, py, w: txt.length * 6.9 + 16, h: 20, rr: n.r * k, lx: px + n.r * k + 9, ly: py });
      }
      boxes.sort((a, b) => a.ly - b.ly);
      for (let pass = 0; pass < 6; pass++) {
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i]!, b = boxes[j]!;
          if (b.lx > a.lx + a.w + 6 || a.lx > b.lx + b.w + 6) continue;
          const dy = b.ly - a.ly, min = (a.h + b.h) / 2 + 3;
          if (Math.abs(dy) < min) { const shift = ((min - Math.abs(dy)) / 2) * (dy >= 0 ? 1 : -1); a.ly -= shift; b.ly += shift; }
        }
      }
      for (const { n, px, py, w, h, rr, lx, ly } of boxes) {
        const L = labelEls.current.get(n.id)!;
        const seld = selectedRef.current.has(n.id);
        const pc = color.get(n.project) ?? "#888";
        L.pill.setAttribute("x", String(lx - 7)); L.pill.setAttribute("y", String(ly - h / 2));
        L.pill.setAttribute("width", String(w)); L.pill.setAttribute("height", String(h));
        L.pill.setAttribute("opacity", seld ? "1" : "0");
        L.pill.setAttribute("stroke", seld ? pc : "transparent");
        L.pill.setAttribute("stroke-width", seld ? "1.2" : "0");
        L.text.setAttribute("x", String(lx)); L.text.setAttribute("y", String(ly + 0.5));
        L.text.setAttribute("fill", seld ? "var(--fg)" : "#e7e9f0");
        L.text.setAttribute("font-weight", seld ? "700" : "600");
        if (Math.abs(ly - py) > rr + 3) {
          L.lead.style.display = "";
          L.lead.setAttribute("x1", String(px + rr * 0.7)); L.lead.setAttribute("y1", String(py));
          L.lead.setAttribute("x2", String(lx - 5)); L.lead.setAttribute("y2", String(ly));
          L.lead.setAttribute("stroke", pc);
        } else L.lead.style.display = "none";
      }
    };
    paintRef.current = paint;

    const fit = () => {
      if (!sn.length) return;
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const n of sn) { x0 = Math.min(x0, (n.x ?? 0) - n.r); y0 = Math.min(y0, (n.y ?? 0) - n.r); x1 = Math.max(x1, (n.x ?? 0) + n.r); y1 = Math.max(y1, (n.y ?? 0) + n.r); }
      const pad = 70, gw = Math.max(1, x1 - x0), gh = Math.max(1, y1 - y0);
      const k = Math.max(0.4, Math.min(2.4, Math.min((W - pad * 2) / gw, (H - pad * 2) / gh)));
      T.current = { k, tx: W / 2 - k * (x0 + gw / 2), ty: H / 2 - k * (y0 + gh / 2) };
      applyTransform();
    };

    sim.stop();
    const warm = lastPos.current.size ? 60 : 250;
    for (let i = 0; i < warm; i++) sim.tick();
    for (const n of sn) if (n.x != null && n.y != null) lastPos.current.set(n.id, { x: n.x, y: n.y });
    applyTransform();
    fit();
    paint();

    if (!reducedMotion()) {
      sim.alpha(0.3).on("tick", () => {
        for (const n of sn) if (n.x != null && n.y != null) lastPos.current.set(n.id, { x: n.x, y: n.y });
        paint();
      }).restart();
    }
    simRef.current = sim;
    return () => { sim.stop(); sim.on("tick", null); simRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, color, byId]);

  // Spacing: re-tune the live forces and reheat WITHOUT re-fitting, so the extra space is visible.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const sim = simRef.current;
    if (!sim) return;
    const sp = spacing;
    (sim.force("link") as ReturnType<typeof forceLink<SimNode, SimLink>> | undefined)?.distance(55 * sp);
    (sim.force("charge") as ReturnType<typeof forceManyBody<SimNode>> | undefined)?.strength(-150 * sp);
    (sim.force("collide") as ReturnType<typeof forceCollide<SimNode>> | undefined)?.radius((d) => (d as SimNode).r + 4 + 6 * sp);
    (sim.force("x") as ReturnType<typeof forceX<SimNode>> | undefined)?.strength(0.05 / sp);
    (sim.force("y") as ReturnType<typeof forceY<SimNode>> | undefined)?.strength(0.07 / sp);
    if (reducedMotion()) { for (let i = 0; i < 120; i++) sim.tick(); paintRef.current(); }
    else sim.alpha(0.6).restart();
  }, [spacing]);

  // Visual-only state: restyle and relayout without touching positions.
  useEffect(() => { paintRef.current(); }, [hover, spotlight, selected, badge, labelMode, zoomPct]);

  // Keep the viewBox and label geometry correct as the stage resizes.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const r = stage.getBoundingClientRect();
      size.current = { w: Math.max(320, r.width), h: Math.max(360, r.height) };
      svgRef.current?.setAttribute("viewBox", `0 0 ${size.current.w} ${size.current.h}`);
      paintRef.current();
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  // pointer: node drag vs canvas pan
  const toLocal = (e: ReactPointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const { w, h } = size.current;
    return { x: (e.clientX - r.left) * (w / r.width), y: (e.clientY - r.top) * (h / r.height) };
  };
  const onNodeDown = (e: ReactPointerEvent, id: string) => {
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    const p = toLocal(e);
    drag.current = { id, moved: false, px: p.x, py: p.y };
  };
  const onSvgDown = (e: ReactPointerEvent) => {
    svgRef.current?.setPointerCapture(e.pointerId);
    const p = toLocal(e);
    pan.current = { px: p.x, py: p.y, tx: T.current.tx, ty: T.current.ty, moved: false };
    stageRef.current?.classList.add("grabbing");
  };
  const onMove = (e: ReactPointerEvent) => {
    const p = toLocal(e);
    if (drag.current) {
      if (Math.hypot(p.x - drag.current.px, p.y - drag.current.py) > DRAG_THRESHOLD) drag.current.moved = true;
      const n = simNodes.current.get(drag.current.id);
      if (n) { n.fx = (p.x - T.current.tx) / T.current.k; n.fy = (p.y - T.current.ty) / T.current.k; }
      if (reducedMotion()) { for (let i = 0; i < 6; i++) simRef.current?.tick(); paintRef.current(); }
      else simRef.current?.alphaTarget(0.3).restart();
      return;
    }
    if (pan.current) {
      if (Math.hypot(p.x - pan.current.px, p.y - pan.current.py) > DRAG_THRESHOLD) pan.current.moved = true;
      T.current.tx = pan.current.tx + (p.x - pan.current.px);
      T.current.ty = pan.current.ty + (p.y - pan.current.py);
      const t = `translate(${T.current.tx} ${T.current.ty}) scale(${T.current.k})`;
      edgesGRef.current?.setAttribute("transform", t);
      nodesGRef.current?.setAttribute("transform", t);
      paintRef.current();
    }
  };
  const onUp = () => {
    stageRef.current?.classList.remove("grabbing");
    if (drag.current) {
      const d = drag.current; drag.current = null;
      const n = simNodes.current.get(d.id);
      if (n) { n.fx = null; n.fy = null; }
      simRef.current?.alphaTarget(0);
      if (!d.moved) toggleSelect(d.id);
    }
    pan.current = null;
  };

  const zoomAt = (x: number, y: number, f: number) => {
    const t = T.current, nk = Math.max(0.3, Math.min(3.2, t.k * f));
    t.tx = x - (x - t.tx) * (nk / t.k); t.ty = y - (y - t.ty) * (nk / t.k); t.k = nk;
    const tr = `translate(${t.tx} ${t.ty}) scale(${t.k})`;
    edgesGRef.current?.setAttribute("transform", tr);
    nodesGRef.current?.setAttribute("transform", tr);
    setZoomPct(Math.round(t.k * 100));
    paintRef.current();
  };
  // Wheel-zoom via a native non-passive listener (React's onWheel can be passive, which no-ops preventDefault).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const { w, h } = size.current;
      const x = (e.clientX - r.left) * (w / r.width), y = (e.clientY - r.top) * (h / r.height);
      zoomAt(x, y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSelect = (id: string) =>
    setSelected((prev) => { const next = new Set(prev); if (!next.delete(id)) next.add(id); return next; });
  const toggleHidden = (p: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (!next.delete(p)) { next.add(p); if (spotlight === p) setSpotlight(null); }
      return next;
    });

  if (data.nodes.length === 0)
    return <p className="empty">This vault has no notes yet, so there is nothing to graph.</p>;

  const seg = <V extends string>(value: V, current: V, set: (v: V) => void, label: string) => (
    <button type="button" aria-pressed={value === current} onClick={() => set(value)}>{label}</button>
  );

  return (
    <div className="graph-wrap">
      <div className="rail">
        <div className="card">
          <section>
            <h3>Labels</h3>
            <div className="seg" role="group" aria-label="Label density">
              {seg<LabelMode>("auto", labelMode, setLabelMode, "Auto")}
              {seg<LabelMode>("all", labelMode, setLabelMode, "All")}
              {seg<LabelMode>("focus", labelMode, setLabelMode, "Focus")}
            </div>
            <p className="hint">{LABEL_HINT[labelMode]}</p>
          </section>
          <section>
            <h3>Node badge</h3>
            <div className="seg grid2" role="group" aria-label="What each node shows">
              {seg<Badge>("title", badge, setBadge, "Title")}
              {seg<Badge>("id", badge, setBadge, "ID")}
              {seg<Badge>("project", badge, setBadge, "Project")}
              {seg<Badge>("backlinks", badge, setBadge, "Backlinks")}
            </div>
          </section>
          <section>
            <h3>Spacing <span className="sub">{SPACING_LABEL(spacing)}</span></h3>
            <input
              className="range" type="range" min={0.6} max={2.4} step={0.2} value={spacing}
              aria-label="Space between nodes" onChange={(e) => setSpacing(parseFloat(e.target.value))}
            />
            <div className="rangerow"><span>Tighter</span><span>Airier</span></div>
          </section>
        </div>
        <div className="card">
          <section>
            <h3>Projects {spotlight && <span className="sub">· spotlighting {spotlight}</span>}</h3>
            <div className="legend">
              {allProjects.map((p) => {
                const count = data.nodes.filter((n) => n.project === p).length;
                const off = hidden.has(p);
                return (
                  <div
                    key={p} className="legrow" data-spot={spotlight === p} data-hidden={off}
                    role="button" tabIndex={0} aria-pressed={spotlight === p}
                    onClick={() => setSpotlight((s) => (s === p ? null : p))}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSpotlight((s) => (s === p ? null : p)); } }}
                  >
                    <span className="sw" style={{ background: color.get(p), ["--sw" as string]: color.get(p) }} />
                    <span className="nm">{p}</span>
                    <span className="ct">{count}</span>
                    <button
                      className="eye" title={off ? "Show in graph" : "Hide from graph"}
                      aria-label={off ? `Show ${p} in graph` : `Hide ${p} from graph`}
                      onClick={(e) => { e.stopPropagation(); toggleHidden(p); }}
                    >
                      <Icon name={off ? "eyeoff" : "eye"} style={{ width: 15, height: 15 }} />
                    </button>
                  </div>
                );
              })}
            </div>
            {spotlight && <button className="spotclear" onClick={() => setSpotlight(null)}>Clear spotlight</button>}
            <p className="hint">
              <b style={{ color: "var(--fg-dim)" }}>Click a row</b> to spotlight that project — its notes and links
              brighten, the rest dim in place. The eye hides a project and relaxes the layout.
            </p>
          </section>
        </div>
      </div>

      <div className="stage" ref={stageRef}>
        <svg
          ref={svgRef} aria-label={`Note graph: ${nodes.length} notes, ${edges.length} links`}
          onPointerDown={onSvgDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        >
          <g ref={edgesGRef}>
            {edges.map((e, i) => (
              <line
                key={`${e.source}>${e.target}`} vectorEffect="non-scaling-stroke"
                ref={(el) => { lineEls.current[i] = el; }}
              />
            ))}
          </g>
          <g ref={nodesGRef}>
            {nodes.map((n) => (
              <g className="gnode" key={n.id}>
                <circle
                  ref={(el) => { if (el) circleEls.current.set(n.id, el); else circleEls.current.delete(n.id); }}
                  r={radius(n.backlinks)} vectorEffect="non-scaling-stroke"
                  role="link" tabIndex={0}
                  aria-label={`${n.title} (${n.project}, ${n.backlinks} backlinks${n.status === "conflict" ? ", in conflict" : ""})`}
                  onPointerEnter={() => setHover(n.id)}
                  onPointerLeave={() => setHover((h) => (h === n.id ? null : h))}
                  onFocus={() => setHover(n.id)}
                  onBlur={() => setHover((h) => (h === n.id ? null : h))}
                  onPointerDown={(e) => onNodeDown(e, n.id)}
                  onKeyDown={(e) => { if (e.key === "Enter") onOpen(n.id); if (e.key === " ") { e.preventDefault(); toggleSelect(n.id); } }}
                />
              </g>
            ))}
          </g>
          <g>
            {nodes.map((n) => (
              <g
                className="glabel" key={n.id} pointerEvents="none"
                ref={(g) => {
                  if (!g) { labelEls.current.delete(n.id); return; }
                  labelEls.current.set(n.id, {
                    g,
                    lead: g.querySelector("line")!,
                    pill: g.querySelector("rect")!,
                    text: g.querySelector("text")!,
                  });
                }}
              >
                <line className="lead" stroke="var(--fg-faint)" strokeWidth={1} opacity={0.5} />
                <rect className="pill" rx={5} ry={5} fill="color-mix(in srgb, var(--graph-bg) 78%, #fff 6%)" />
                <text dominantBaseline="middle" />
              </g>
            ))}
          </g>
        </svg>

        <div className="stagehint">Click notes to pin several at once · scroll to zoom · drag the canvas to pan</div>
        <div className="ov readout">
          <span><b>{nodes.length}</b> notes</span>
          <span><b>{edges.length}</b> links</span>
          <span><b>{zoomPct}%</b></span>
        </div>
        <div className="ov zoom">
          <button aria-label="Zoom in" onClick={() => zoomAt(size.current.w / 2, size.current.h / 2, 1.2)}><Icon name="plus" /></button>
          <button aria-label="Zoom out" onClick={() => zoomAt(size.current.w / 2, size.current.h / 2, 1 / 1.2)}><Icon name="minus" /></button>
          <button aria-label="Fit to view" onClick={fitNow}><Icon name="fit" /></button>
        </div>
        {selected.size > 0 && (
          <div className="ov tray">
            <div className="pills">
              {[...selected].map((id) => {
                const n = byId.get(id);
                if (!n) return null;
                return (
                  <span className="selpill" key={id}>
                    <i style={{ background: color.get(n.project) }} />
                    <span style={{ cursor: "pointer" }} onClick={() => onOpen(id)}>{n.title}</span>
                    <button className="x" aria-label={`Deselect ${n.title}`} onClick={() => toggleSelect(id)}><Icon name="x" style={{ width: 12, height: 12 }} /></button>
                  </span>
                );
              })}
            </div>
            <button className="btn" style={{ flex: "none", padding: "5px 10px" }} onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}
      </div>
    </div>
  );

  // Fit the current layout into view (used by the fit button). Reads live positions from simNodes.
  function fitNow() {
    const sn = [...simNodes.current.values()];
    if (!sn.length) return;
    const { w: W, h: H } = size.current;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const n of sn) { x0 = Math.min(x0, (n.x ?? 0) - n.r); y0 = Math.min(y0, (n.y ?? 0) - n.r); x1 = Math.max(x1, (n.x ?? 0) + n.r); y1 = Math.max(y1, (n.y ?? 0) + n.r); }
    const pad = 70, gw = Math.max(1, x1 - x0), gh = Math.max(1, y1 - y0);
    const k = Math.max(0.4, Math.min(2.4, Math.min((W - pad * 2) / gw, (H - pad * 2) / gh)));
    T.current = { k, tx: W / 2 - k * (x0 + gw / 2), ty: H / 2 - k * (y0 + gh / 2) };
    const tr = `translate(${T.current.tx} ${T.current.ty}) scale(${k})`;
    edgesGRef.current?.setAttribute("transform", tr);
    nodesGRef.current?.setAttribute("transform", tr);
    setZoomPct(Math.round(k * 100));
    paintRef.current();
  }
}
