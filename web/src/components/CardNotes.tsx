import { useState } from "react";
import { api } from "../api/client";
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
 * One note row inside the expanded history, with inline edit + delete/done.
 * The author can edit their own words; the author (or, server-side, the PL /
 * a manager) can mark it done, which hard-deletes it — one note, one source,
 * so it clears from the card and the to-do box together.
 */
function NoteItem({ note, onChanged }: { note: Note; onChanged?: () => void }) {
  const { actor, nameOf } = useApp();
  const [editing, setEditing] = useState(false);
  const [txt, setTxt] = useState(note.body);
  const [busy, setBusy] = useState(false);
  const mine = note.authorId === actor.id;

  const save = async () => {
    if (!txt.trim() || txt.trim() === note.body) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/projects/notes/${note.id}`, { body: txt.trim() });
      setEditing(false);
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  const done = async () => {
    setBusy(true);
    try {
      await api.del(`/projects/notes/${note.id}`);
      onChanged?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cn-item">
      <div className="cn-meta">
        <b>{nameOf(note.authorId)}</b>
        <span className="cn-role">{note.authorRole}</span>
        <span className="cn-time">{timeAgo(note.createdAt)}</span>
        {mine && !editing && (
          <span className="cn-actions">
            <button className="cn-link" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button className="cn-link cn-done" disabled={busy} onClick={done} title="Mark done — clears it everywhere">
              ✓ Done
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <div className="cn-edit">
          <textarea value={txt} onChange={(e) => setTxt(e.target.value)} rows={2} autoFocus />
          <div className="cn-edit-actions">
            <button className="btn-sm btn-ghost" onClick={() => { setTxt(note.body); setEditing(false); }}>
              Cancel
            </button>
            <button className="btn-sm btn-pl" disabled={busy} onClick={save}>
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="cn-body">{note.body}</div>
      )}
    </div>
  );
}

/**
 * Notes, on the card itself. Collapsed it's the exact same single line the
 * card always showed (latest note + author) plus a count chip — zero extra
 * height, nothing else moves. Tapping it unfolds the full history inline,
 * newest first, with an add button that opens the existing Notes sheet. Each
 * note can be edited or marked done inline by its author (onChanged refreshes
 * the board so the card + to-do box stay in sync).
 */
export default function CardNotes({ notes, onAdd, onChanged }: { notes: Note[]; onAdd: () => void; onChanged?: () => void }) {
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
            <NoteItem key={n.id} note={n} onChanged={onChanged} />
          ))}
          <button className="btn-sm btn-ghost cn-add" onClick={onAdd}>
            ＋ Add note
          </button>
        </div>
      )}
    </div>
  );
}
