import { useEffect, useRef, useState } from "react";
import { writeNote, type ContradictionWarning, type NoteDetail } from "./api";
import { Icon } from "./icons";

/**
 * Create / edit a note. One save = one git commit (provenance source `web/ui`). After saving, any contradiction
 * warnings returned by the server are shown inline so the writer sees the collision before leaving the editor.
 */
export function Editor({
  open, initial, projects, onClose, onSaved,
}: {
  open: boolean;
  initial: NoteDetail | null; // null → new note
  projects: string[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("memex");
  const [key, setKey] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [body, setBody] = useState("");
  const [why, setWhy] = useState("");
  const [warnings, setWarnings] = useState<ContradictionWarning[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const titleRef = useRef<HTMLInputElement>(null);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  // Reset the form only when the editor opens or the target note changes — NOT when the project list
  // refreshes (that would wipe the contradiction warnings shown after a save).
  useEffect(() => {
    if (!open) return;
    const n = initial?.note;
    setTitle(n?.title ?? "");
    setProject(n?.project ?? projectsRef.current[0] ?? "memex");
    setKey(n?.key ?? "");
    setTags(n?.tags ?? []);
    setTagInput("");
    setBody(n?.body ?? "");
    setWhy(initial?.provenance.why ?? "");
    setWarnings([]);
    setError(undefined);
    setBusy(false);
    const t = setTimeout(() => titleRef.current?.focus(), 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, "");
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagInput("");
  };

  const save = async () => {
    if (!title.trim() || !body.trim()) return;
    setBusy(true); setError(undefined);
    try {
      const r = await writeNote({
        title: title.trim(), body, project: project.trim() || undefined,
        tags, key: key.trim() || null, why: why.trim() || undefined,
      });
      const verb = r.created ? "Note created" : r.revived ? "Restored from archive" : "Saved";
      onSaved(`${verb}${r.commit ? ` · commit ${r.commit.slice(0, 7)}` : ""}`);
      if (r.warnings.length > 0) { setWarnings(r.warnings); setBusy(false); }
      else onClose();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const projectOptions = [...new Set([...projects, project].filter(Boolean))].sort();

  return (
    <div className={`modal${open ? " on" : ""}`} aria-hidden={!open}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={initial ? "Edit note" : "New note"}>
        <div className="shead">
          <Icon name="pencil" style={{ color: "var(--accent)" }} />
          <h2 style={{ fontSize: 16 }}>{initial ? "Edit note" : "New note"}</h2>
          <button className="icon-btn" style={{ marginLeft: "auto" }} aria-label="Close" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="sbody">
          <div className="field">
            <label htmlFor="ed-ttl">Title</label>
            <input id="ed-ttl" ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A short, declarative title" />
          </div>
          <div className="frow">
            <div className="field">
              <label htmlFor="ed-proj">Project</label>
              <input id="ed-proj" list="ed-projects" value={project} onChange={(e) => setProject(e.target.value)} placeholder="memex" />
              <datalist id="ed-projects">{projectOptions.map((p) => <option key={p} value={p} />)}</datalist>
            </div>
            <div className="field">
              <label htmlFor="ed-key">Key <span className="opt">— optional</span></label>
              <input id="ed-key" className="mono" value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. index-choice" />
              <p className="fh">A stable key lets a later write collide with this note and open a conflict.</p>
            </div>
          </div>
          <div className="field">
            <label>Tags</label>
            <div className="tagedit">
              {tags.map((t, i) => (
                <span className="tag" key={t}>
                  {t}
                  <button aria-label={`Remove tag ${t}`} onClick={() => setTags((prev) => prev.filter((_, j) => j !== i))}>×</button>
                </span>
              ))}
              <input
                value={tagInput} onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                onBlur={addTag} placeholder="Add a tag, press Enter"
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="ed-body">Body <span className="opt">— markdown, <code className="mono" style={{ fontSize: 11 }}>[[wikilinks]]</code> supported</span></label>
            <textarea id="ed-body" rows={7} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write the fact. Link related notes with [[note-id]]." />
          </div>
          <div className="field">
            <label htmlFor="ed-why">Why <span className="opt">— the reason for this write</span></label>
            <input id="ed-why" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Recorded in the commit, so the memory stays accountable" />
            <p className="fh">Every save is one git commit stamped with who wrote it and why.</p>
          </div>
          {warnings.length > 0 && (
            <div className="noticebar warn" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
              {warnings.map((w) => (
                <div key={w.id} style={{ display: "flex", gap: 9 }}>
                  <Icon name="alert" />
                  <span>Saved, but this may contradict <b>{w.title ?? w.id}</b> on key <code className="mono">{w.key}</code>: it states {w.existingValues.join(", ")} where this states {w.candidateValues.join(", ")}. Settle it in the Conflicts inbox.</span>
                </div>
              ))}
            </div>
          )}
          {error && <p className="banner err" style={{ marginBottom: 0 }}>{error}</p>}
        </div>
        <div className="sfoot">
          <span style={{ fontSize: 11.5, color: "var(--fg-faint)" }}>Saved as one commit · authored by <span className="mono">web/ui</span></span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 9 }}>
            <button className="btn" onClick={onClose}>{warnings.length > 0 ? "Done" : "Cancel"}</button>
            <button className="btn primary" disabled={busy || !title.trim() || !body.trim()} onClick={save}>
              {initial ? "Save note" : "Create note"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
