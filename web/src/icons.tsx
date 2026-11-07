/** A tiny stroked-icon set, rendered once as an SVG sprite and referenced by name with <Icon/>. */

type IconName =
  | "graph" | "list" | "alert" | "search" | "plus" | "minus" | "fit"
  | "moon" | "x" | "pencil" | "archive" | "eye" | "eyeoff" | "restore" | "open";

export function Icon({ name, className, style }: { name: IconName; className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 24 24" className={`i${className ? ` ${className}` : ""}`} style={style} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/** Mount once near the app root; <Icon/> references these by id. */
export function IconSprite() {
  return (
    <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <g id="i-graph"><circle cx="5" cy="6" r="2.2" /><circle cx="17" cy="7" r="2.2" /><circle cx="12" cy="17" r="2.2" /><path d="M7 7l8 .5M6.5 8l4.5 7M15 9l-2.5 6" /></g>
        <g id="i-list"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></g>
        <g id="i-alert"><path d="M12 9v4M12 17h.01M10.3 4l-7 12a2 2 0 0 0 1.7 3h14a2 2 0 0 0 1.7-3l-7-12a2 2 0 0 0-3.4 0z" /></g>
        <g id="i-search"><circle cx="11" cy="11" r="6" /><path d="M20 20l-3.5-3.5" /></g>
        <g id="i-plus"><path d="M12 5v14M5 12h14" /></g>
        <g id="i-minus"><path d="M5 12h14" /></g>
        <g id="i-fit"><path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" /></g>
        <g id="i-moon"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></g>
        <g id="i-x"><path d="M6 6l12 12M18 6L6 18" /></g>
        <g id="i-pencil"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></g>
        <g id="i-archive"><path d="M4 7h16v3H4zM5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9M10 14h4" /></g>
        <g id="i-eye"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="2.6" /></g>
        <g id="i-eyeoff"><path d="M4 4l16 16M9.5 5.4A10 10 0 0 1 12 5c6.5 0 10 7 10 7a16 16 0 0 1-3 3.6M6.1 7.3A16 16 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 3.2-.5M9.5 9.6a2.6 2.6 0 0 0 3.6 3.7" /></g>
        <g id="i-restore"><path d="M4 7h16v3H4zM5 10v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-9M12 13v4M12 13l-2 2M12 13l2 2" /></g>
        <g id="i-open"><path d="M7 17L17 7M9 7h8v8" /></g>
      </defs>
    </svg>
  );
}
