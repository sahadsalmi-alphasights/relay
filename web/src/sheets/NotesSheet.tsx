import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Note, Project } from "../api/types";
import Sheet from "../components/Sheet";
import { useApp } from "../state/AppContext";
import type { NotesTarget } from "../Shell";

export default function NotesSheet({ target, onClose }: { target: NotesTarget; onClose: () => void }) {
  const { actor, nameOf } = useApp();
  const [project, setProject] = useState<Project | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [txt, setTxt] = useState("");
  const [pub, setPub] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const detail = await api.get<{ project: Project }>(`/projects/${target.projectId}`);
    setProject(detail.project);
    setNotes(await api.get<Note[]>(`/projects/${target.projectId}/notes`));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.projectId]);

  const add = async () => {
    if (!txt.trim()) return;
    setBusy(true);
    try {
      await api.post(`/projects/${target.projectId}/notes`, { body: txt.trim(), isPublic: pub });
      setTxt("");
      setPub(false);
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose}>
      <h2>Notes</h2>
        <div className="sub">
          {project ? `${project.client} · ${project.topic}. ` : ""}
          Public notes are seen by everyone on the project; private notes only by you.
        </div>
        {notes.length === 0 && <div className="empty">No notes yet.</div>}
        {notes.map((n) => (
          <div key={n.id} className="note-item">
            <div className="note-head">
              <span className="note-author">
                {nameOf(n.authorId)} · {n.authorRole}
              </span>
              <span className={"mini " + (n.isPublic ? "free" : "busy")}>{n.isPublic ? "Public" : "Private"}</span>
            </div>
            <div className="note-text">{n.body}</div>
          </div>
        ))}
        <div className="sheet-footer">
          <input
            value={txt}
            onChange={(e) => setTxt(e.target.value)}
            placeholder="Add a note…"
            style={{ width: "100%", padding: 11, borderRadius: 11, border: "1px solid var(--line)", fontSize: 14, color: "var(--ink)", background: "var(--bg)" }}
          />
          <div className="note-controls">
            <button className={"sw " + (pub ? "on" : "")} onClick={() => setPub(!pub)}>
              <span />
            </button>
            <span>{pub ? "Public — everyone on the project" : `Private — only ${actor.name}`}</span>
          </div>
          <button className="btn btn-pl" style={{ width: "100%" }} disabled={busy} onClick={add}>
            Add note
          </button>
          <button className="close" onClick={onClose}>
            Close
          </button>
        </div>
    </Sheet>
  );
}
