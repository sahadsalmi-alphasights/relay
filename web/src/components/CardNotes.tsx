import { useState } from "react";
import type { Note } from "../api/types";
import { useApp } from "../state/AppContext";

function timeAgo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

/**
 * Notes, on the card itself. Collapsed it's the exact same single line the
 * card always showed (latest note + author) plus a count chip — zero extra
 * height, nothing else moves. Tapping it unfolds the full history inline,
 * newest first, with an add button that opens the existing Notes sheet.
 */
export default function CardNotes({ notes, onAdd }: { notes: Note[]; onAdd: () => void }) {
  const [open, setOpen] = useState(false);
  const { nameOf } = useApp();
  if (notes.length === 0) return null;
  const latest = notes[notes.length - 1];

  return (
    <div className="card-notes">
      <button
        className="note-preview card-notes-head"
        onClick={() => setOpen((o) => !o)}
        title={open ? "Collapse notes" : `Show all ${notes.length} note${notes.length === 1 ? "" : "s"}`}
      >
        <span className="cn-line">
          📝 <b>{nameOf(latest.authorId)}</b>: {latest.body.length > 80 ? `${latest.body.slice(0, 80)}…` : latest.body}
        </span>
        {notes.length > 1 && <span className="cn-count">{notes.length}</span>}
        <span className="cn-caret">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="cn-list">
          {[...notes].reverse().map((n) => (
            <div key={n.id} className="cn-item">
              <div className="cn-meta">
                <b>{nameOf(n.authorId)}</b>
                <span className="cn-role">{n.authorRole}</span>
                <span className="cn-time">{timeAgo(n.createdAt)}</span>
              </div>
              <div className="cn-body">{n.body}</div>
            </div>
          ))}
          <button className="btn-sm btn-ghost cn-add" onClick={onAdd}>
            ＋ Add note
          </button>
        </div>
      )}
    </div>
  );
}
