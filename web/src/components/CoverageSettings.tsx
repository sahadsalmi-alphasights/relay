import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { CoverageSettings as CS } from "../api/types";
import { useApp } from "../state/AppContext";

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const toMin = (hhmmStr: string) => {
  const [h, m] = hhmmStr.split(":").map(Number);
  return h * 60 + m;
};

/** A HH:MM editor bound to a minutes-of-day field. */
function TimeField({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <input
      type="time"
      className="cs-time"
      disabled={disabled}
      value={hhmm(value)}
      onChange={(e) => onChange(toMin(e.target.value))}
    />
  );
}

/** A minutes stepper for durations. */
function DurationField({ value, step, onChange, disabled }: { value: number; step: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <span className="cs-stepper">
      <button disabled={disabled} onClick={() => onChange(Math.max(1, value - step))}>−</button>
      <span className="val">{value}</span>
      <button disabled={disabled} onClick={() => onChange(Math.min(480, value + step))}>＋</button>
      <span className="cs-unit">min</span>
    </span>
  );
}

function Row({ label, sub, children }: { label: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="cs-row">
      <div>
        <div className="cs-rl">{label}</div>
        <div className="cs-rs">{sub}</div>
      </div>
      <div className="cs-controls">{children}</div>
    </div>
  );
}

/**
 * Settings → Coverage. Owner-editable lunch + evening-coverage timings that
 * used to be hardcoded in the prompts and the reset scheduler. Non-owners see
 * it read-only. Saving PATCHes /settings/coverage and (server-side) publishes
 * a `settings` invalidate, so every client's prompts and the scheduler pick up
 * the change live; onSaved bumps this session immediately too.
 */
export default function CoverageSettings({ onSaved }: { onSaved: () => void }) {
  const { actor } = useApp();
  const readOnly = !actor.isOwner;
  const [draft, setDraft] = useState<CS | null>(null);
  const [saved, setSaved] = useState<CS | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    api.get<CS>("/settings/coverage").then((s) => {
      setDraft(s);
      setSaved(s);
    });
  }, []);

  if (!draft || !saved) return <div className="empty">Loading…</div>;

  const set = (k: keyof CS, v: number) => {
    setDraft({ ...draft, [k]: v });
    setOk(false);
  };
  const dirty = (Object.keys(draft) as (keyof CS)[]).some((k) => draft[k] !== saved[k]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patch<CS>("/settings/coverage", draft);
      setDraft(updated);
      setSaved(updated);
      setOk(true);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="scope-note">
        {readOnly
          ? "Coverage prompt timings — read-only (owners can change these). Times are Asia/Dubai."
          : "Adjust when the lunch and evening-coverage prompts appear and how long they last. Changes apply to everyone. Times are Asia/Dubai."}
      </div>

      <div className="card cs-card">
        <div className="cs-head">🍱 Lunch</div>
        <Row label="Ask about lunch between" sub="The midday prompt window (weekdays).">
          <TimeField value={draft.lunchPromptStartMin} onChange={(v) => set("lunchPromptStartMin", v)} disabled={readOnly} />
          <span className="cs-to">to</span>
          <TimeField value={draft.lunchPromptEndMin} onChange={(v) => set("lunchPromptEndMin", v)} disabled={readOnly} />
        </Row>
        <Row label="Auto-switch off after" sub="Out to Lunch clears itself this long after turning on.">
          <DurationField value={draft.lunchAutoOffMin} step={15} onChange={(v) => set("lunchAutoOffMin", v)} disabled={readOnly} />
        </Row>
        <Row label="“Remind me” snooze" sub="How long the prompt hides when someone taps Remind me.">
          <DurationField value={draft.lunchSnoozeMin} step={5} onChange={(v) => set("lunchSnoozeMin", v)} disabled={readOnly} />
        </Row>
      </div>

      <div className="card cs-card">
        <div className="cs-head">🌙 Evening coverage</div>
        <Row label="Ask about evening coverage between" sub="The after-hours prompt window (weekday evenings).">
          <TimeField value={draft.eveningPromptStartMin} onChange={(v) => set("eveningPromptStartMin", v)} disabled={readOnly} />
          <span className="cs-to">to</span>
          <TimeField value={draft.eveningPromptEndMin} onChange={(v) => set("eveningPromptEndMin", v)} disabled={readOnly} />
        </Row>
        <Row label="Reset each morning between" sub="Everyone's opt-in returns to off before the working day.">
          <TimeField value={draft.eveningResetStartMin} onChange={(v) => set("eveningResetStartMin", v)} disabled={readOnly} />
          <span className="cs-to">to</span>
          <TimeField value={draft.eveningResetEndMin} onChange={(v) => set("eveningResetEndMin", v)} disabled={readOnly} />
        </Row>
        <Row label="“Remind me” snooze" sub="How long the prompt hides when someone taps Remind me.">
          <DurationField value={draft.eveningSnoozeMin} step={15} onChange={(v) => set("eveningSnoozeMin", v)} disabled={readOnly} />
        </Row>
      </div>

      {error && <div className="err-line">{error}</div>}
      {!readOnly && (
        <div className="cs-actions">
          <button className="btn btn-pl" disabled={busy || !dirty} onClick={save}>
            {busy ? "Saving…" : "Save changes"}
          </button>
          <button className="btn btn-ghost" disabled={busy || !dirty} onClick={() => { setDraft(saved); setOk(false); }}>
            Discard
          </button>
          {ok && !dirty && <span className="cs-ok">✓ Saved — live for everyone</span>}
        </div>
      )}
    </>
  );
}
