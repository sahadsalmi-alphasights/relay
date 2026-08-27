import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { Note, Project } from "../api/types";
import { useApp } from "../state/AppContext";
import type { NotesTarget } from "../Shell";
import { Icon } from "./Icon";

interface BoardItem {
  project: Project;
  notes: Note[];
}

interface PersonalNote {
  id: string;
  personId: string;
  body: string;
  createdAt: string;
}

/** A single project note inside the to-do box: edit inline, or mark done (delete). */
function TodoNote({ note, onChanged }: { note: Note; onChanged: () => void }) {
  const { actor } = useApp();
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
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const done = async () => {
    setBusy(true);
    try {
      await api.del(`/projects/notes/${note.id}`);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="todo-note-edit">
        <textarea value={txt} onChange={(e) => setTxt(e.target.value)} rows={2} autoFocus />
        <div className="todo-note-edit-actions">
          <button className="btn-sm btn-ghost" onClick={() => { setTxt(note.body); setEditing(false); }}>
            Cancel
          </button>
          <button className="btn-sm btn-pl" disabled={busy} onClick={save}>
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="todo-note">
      <span className="todo-note-body">{note.body}</span>
      <span className="todo-note-actions">
        <button className="cn-link" disabled={!mine} title={mine ? "Edit" : "Only the author can edit"} onClick={() => setEditing(true)}>
          Edit
        </button>
        <button className="cn-link cn-done" disabled={busy} title="Mark done — clears it everywhere" onClick={done}>
          <Icon name="check" size={13} /> Done
        </button>
      </span>
    </div>
  );
}

function Section({ title, items, onOpenProject, onChanged }: {
  title: string;
  items: BoardItem[];
  onOpenProject: (t: NotesTarget) => void;
  onChanged: () => void;
}) {
  return (
    <div className="todo-section">
      <div className="todo-section-head">
        {title} <span className="count">{items.reduce((s, it) => s + it.notes.length, 0)}</span>
      </div>
      {items.length === 0 ? (
        <div className="todo-empty">Nothing to action.</div>
      ) : (
        <table className="todo-table">
          <tbody>
            {items.map((it) => (
              <tr key={it.project.id}>
                <td className="todo-proj">
                  <button className="todo-proj-link" onClick={() => onOpenProject({ projectId: it.project.id })} title="Open notes">
                    {it.project.client}
                    {it.project.topic ? <span className="todo-proj-topic"> · {it.project.topic}</span> : null}
                  </button>
                </td>
                <td className="todo-notes-cell">
                  {it.notes.map((n) => (
                    <TodoNote key={n.id} note={n} onChanged={onChanged} />
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** One personal reminder (Admin section): edit inline or mark done (delete). */
function AdminNote({ note, onChanged }: { note: PersonalNote; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [txt, setTxt] = useState(note.body);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!txt.trim() || txt.trim() === note.body) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/people/me/notes/${note.id}`, { body: txt.trim() });
      setEditing(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const done = async () => {
    setBusy(true);
    try {
      await api.del(`/people/me/notes/${note.id}`);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="todo-note-edit">
        <textarea value={txt} onChange={(e) => setTxt(e.target.value)} rows={2} autoFocus />
        <div className="todo-note-edit-actions">
          <button className="btn-sm btn-ghost" onClick={() => { setTxt(note.body); setEditing(false); }}>
            Cancel
          </button>
          <button className="btn-sm btn-pl" disabled={busy} onClick={save}>
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="todo-note todo-admin-note">
      <span className="todo-note-body">{note.body}</span>
      <span className="todo-note-actions">
        <button className="cn-link" title="Edit" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button className="cn-link cn-done" disabled={busy} title="Mark done — removes this reminder" onClick={done}>
          <Icon name="check" size={13} /> Done
        </button>
      </span>
    </div>
  );
}

/** Admin section — your own manual reminders (not tied to a project). */
function AdminSection({ notes, onChanged }: { notes: PersonalNote[]; onChanged: () => void }) {
  const [txt, setTxt] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!txt.trim()) return;
    setBusy(true);
    try {
      await api.post(`/people/me/notes`, { body: txt.trim() });
      setTxt("");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="todo-section">
      <div className="todo-section-head">
        Admin <span className="count">{notes.length}</span>
      </div>
      {notes.length === 0 && <div className="todo-empty">No reminders yet — add one below.</div>}
      {notes.map((n) => (
        <AdminNote key={n.id} note={n} onChanged={onChanged} />
      ))}
      <div className="todo-admin-add">
        <input
          value={txt}
          onChange={(e) => setTxt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
          placeholder="Write a reminder for yourself…"
        />
        <button className="btn-sm btn-pl" disabled={busy || !txt.trim()} onClick={add}>
          <Icon name="plus" size={13} /> Add
        </button>
      </div>
    </div>
  );
}

/**
 * To-do mini-box (2026-07-28) — a docked, Intercom-style expandable widget in
 * the bottom-right corner, on both the Personal Delivery and Project Leading
 * tabs. Sections: Delivery (projects you deliver on that have a note), PLing
 * (projects you lead that have a note), and Admin (your own manual reminders,
 * server-backed so they follow you across devices). Project notes are the very
 * same rows the cards show, so editing or marking one done here (onChanged →
 * onReload) updates the card too — one note, one source.
 */
export default function NotesTodoBox({ reloadTick, onReload, onOpenProject }: {
  reloadTick: number;
  onReload: () => void;
  onOpenProject: (t: NotesTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const [delivery, setDelivery] = useState<BoardItem[]>([]);
  const [pling, setPling] = useState<BoardItem[]>([]);
  const [admin, setAdmin] = useState<PersonalNote[]>([]);
  // Local refresh for personal reminders — bumped on add/edit/done so the
  // Admin section updates instantly without reloading the whole board.
  const [adminRev, setAdminRev] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [deliverBoard, leadBoard] = await Promise.all([
        api.get<BoardItem[]>(`/projects/board?role=delivering&scope=mine&status=active`),
        api.get<BoardItem[]>(`/projects/board?role=leading&scope=mine&archived=false`),
      ]);
      if (!alive) return;
      setDelivery(deliverBoard.filter((it) => (it.notes?.length ?? 0) > 0));
      setPling(leadBoard.filter((it) => (it.notes?.length ?? 0) > 0));
    };
    void load();
    return () => {
      alive = false;
    };
  }, [reloadTick]);

  useEffect(() => {
    let alive = true;
    api.get<PersonalNote[]>(`/people/me/notes`).then((rows) => alive && setAdmin(rows)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [reloadTick, adminRev]);

  const total =
    delivery.reduce((s, it) => s + it.notes.length, 0) +
    pling.reduce((s, it) => s + it.notes.length, 0) +
    admin.length;

  return (
    <div className="todo-dock">
      {open && (
        <div className="todo-panel" role="dialog" aria-label="Notes to-do">
          <div className="todo-panel-head">
            <span><Icon name="notes" /> Notes to-do</span>
            <button className="todo-close" onClick={() => setOpen(false)} aria-label="Collapse">
              <Icon name="x" />
            </button>
          </div>
          <div className="todo-panel-body">
            <Section title="Delivery" items={delivery} onOpenProject={onOpenProject} onChanged={onReload} />
            <Section title="PLing" items={pling} onOpenProject={onOpenProject} onChanged={onReload} />
            <AdminSection notes={admin} onChanged={() => setAdminRev((r) => r + 1)} />
          </div>
        </div>
      )}
      <button
        className={"todo-fab " + (open ? "open" : "")}
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Collapse notes to-do" : "Open notes to-do"}
        title="Notes to-do"
      >
        {open ? <Icon name="chevron-down" /> : <Icon name="notes" />}
        {!open && total > 0 && <span className="todo-fab-badge">{total}</span>}
      </button>
    </div>
  );
}
