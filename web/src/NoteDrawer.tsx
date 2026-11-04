import { useEffect, useState, type MouseEvent } from "react";
import { fetchNote, type NoteDetail } from "./api";
import { Icon } from "./icons";

const swatchStyle = (c?: string): React.CSSProperties => ({ background: c });

/**
 * Slide-over note view: provenance badge, status notices, rendered markdown (with wikilink interception) and
 * backlinks. Stays mounted so it can animate; keeps showing the last note while it slides closed.
 */
export function NoteDrawer({
  id, color, onClose, onOpenNote, onEdit, onArchive, onRestore, onGoConflicts,
}: {
  id: string | null;
  color: Map<string, string>;
  onClose: () => void;
  onOpenNote: (id: string) => void;
  onEdit: (detail: NoteDetail) => void;
  onArchive: (id: string) => void;
  onRestore: (id: string) => void;
  onGoConflicts: () => void;
}) {
  const [detail, setDetail] = useState<NoteDetail>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!id) return; // keep the last note visible while the drawer slides closed
    let live = true;
    setError(undefined);
    setDetail(undefined); // don't show the previous note under a newly opened one
    fetchNote(id).then(
      (d) => { if (live) setDetail(d); },
      (e: Error) => { if (live) setError(e.message); },
    );
    return () => { live = false; };
  }, [id]);

  const open = id != null;
  const note = detail?.note;

  const onBodyClick = (e: MouseEvent<HTMLElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (a.classList.contains("missing")) return e.preventDefault();
    if (a.classList.contains("wikilink")) {
      e.preventDefault();
      const target = a.getAttribute("data-id") ?? a.getAttribute("href")?.replace("/note/", "");
      if (target) onOpenNote(target);
    }
  };

  return (
    <>
      <div className={`scrim${open ? " on" : ""}`} onClick={onClose} />
      <aside className={`drawer${open ? " on" : ""}`} aria-label="Note" aria-hidden={!open}>
        <div className="dhead">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="crumb">
              {note && <span className="sw" style={swatchStyle(color.get(note.project))} />}
              {note ? `${note.project}${note.key ? ` · key ${note.key}` : ""}` : ""}
            </div>
            <h1 style={{ fontSize: 20, letterSpacing: "-.01em" }}>{note?.title ?? (error ? "Not found" : "Loading…")}</h1>
          </div>
          {note && note.status !== "archived" && (
            <button className="icon-btn" title="Edit note" aria-label="Edit note" onClick={() => detail && onEdit(detail)}><Icon name="pencil" /></button>
          )}
          {note && note.status === "archived" ? (
            <button className="icon-btn" title="Restore from archive" aria-label="Restore from archive" onClick={() => onRestore(note.id)}><Icon name="restore" /></button>
          ) : note ? (
            <button className="icon-btn" title="Archive (kept in git history)" aria-label="Archive note" onClick={() => onArchive(note.id)}><Icon name="archive" /></button>
          ) : null}
          <button className="icon-btn" title="Close" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="dbody">
          {error && <p className="banner err">{error}</p>}
          {note && detail && (
            <>
              <dl className="prov-badge">
                <dt>author</dt><dd><span className="mono">{detail.provenance.source ?? "unknown"}</span></dd>
                {detail.provenance.session && (<><dt>session</dt><dd><span className="mono">{detail.provenance.session}</span></dd></>)}
                <dt>updated</dt><dd>{detail.provenance.updated.slice(0, 10)}</dd>
                {detail.provenance.why && (<><dt>why</dt><dd className="why">“{detail.provenance.why}”</dd></>)}
              </dl>
              {note.status === "conflict" && (
                <div className="noticebar warn">
                  <Icon name="alert" />
                  <span>Flagged as conflicting with another note.{" "}
                    <a href="#" onClick={(e) => { e.preventDefault(); onGoConflicts(); }}>Open the Conflicts inbox</a>
                  </span>
                </div>
              )}
              {note.status === "superseded" && (
                <div className="noticebar neutral"><Icon name="archive" />Superseded when a conflict was resolved for another note. Kept for history.</div>
              )}
              {note.status === "archived" && (
                <div className="noticebar neutral"><Icon name="archive" />Archived. Memex never hard-deletes — this note is still in git history and can be restored.</div>
              )}
              <div className="md" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: detail.html }} />
              <div className="backlinks">
                <h4>Backlinks ({detail.backlinks.length})</h4>
                {detail.backlinks.length === 0
                  ? <p style={{ color: "var(--fg-faint)", fontSize: 12.5 }}>No notes link here yet.</p>
                  : detail.backlinks.map((b) => (
                    <button key={b.id} className="bl" onClick={() => onOpenNote(b.id)}>
                      <span className="sw" style={swatchStyle(color.get(b.project))} />
                      <span className="bltitle">{b.title}</span>
                      <span className="blproj">{b.project}</span>
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}
