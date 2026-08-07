import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { CoverageSettings, Person } from "../api/types";
import { DEFAULT_COVERAGE } from "../api/types";
import { dubaiDateKey, dubaiMinute, isDubaiWeekend } from "../lib/time";
import { track } from "../lib/track";
import { useApp } from "../state/AppContext";

/**
 * Daily nudge pop-ups, same family as the morning calls-sold dialog: the
 * 18:00 "free for evening coverage tonight?" ask and the 12:30 "going for
 * lunch?" ask. Answering Yes flips the person's own live toggle (evening
 * coverage / out-to-lunch) through the same self-serve routes the sidebar
 * switches use; No parks the prompt for the rest of the (Dubai) day; Remind
 * snoozes it. All bookkeeping is per-person, per-day, in localStorage — the
 * server has no notion of "answered the prompt", only of the toggles.
 */
interface PromptState {
  date: string;
  done?: boolean;
  snoozeUntil?: number;
}

function readState(key: string, today: string): PromptState {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { date: today };
    const parsed = JSON.parse(raw) as PromptState;
    // A stale entry from a previous day resets — every day asks fresh.
    return parsed.date === today ? parsed : { date: today };
  } catch {
    return { date: today };
  }
}

function writeState(key: string, state: PromptState) {
  localStorage.setItem(key, JSON.stringify(state));
}

function PromptDialog({
  icon,
  title,
  body,
  yesLabel,
  remindLabel,
  storageKey,
  promptKind,
  inWindow,
  snoozeMs,
  onYes,
}: {
  icon: string;
  title: string;
  body: string;
  yesLabel: string;
  remindLabel: string;
  storageKey: string;
  /** Telemetry dimension — which coverage prompt this is (lunch | evening). */
  promptKind: string;
  inWindow: boolean;
  snoozeMs: number;
  onYes: () => Promise<void>;
}) {
  const { nowMs } = useApp();
  const today = dubaiDateKey(nowMs);
  const [busy, setBusy] = useState(false);
  // A local version bump forces an immediate re-render when the prompt is
  // answered — the dialog's visibility is derived from localStorage, which
  // React can't observe on its own, so without this the No/Remind buttons
  // only took effect on the next 30s nowMs tick (looked unresponsive).
  const [, bump] = useState(0);
  // Re-read on every render, so a snooze also expires naturally as nowMs ticks.
  const state = readState(storageKey, today);
  const hidden = !inWindow || !!state.done || (state.snoozeUntil != null && Date.now() < state.snoozeUntil);

  // Telemetry: record when the prompt actually surfaces (fires on the false→
  // true edge as `hidden` recomputes each render).
  useEffect(() => {
    if (!hidden) track("prompt_shown", { prompt: promptKind });
  }, [hidden, promptKind]);

  if (hidden) return null;

  const settle = (next: PromptState) => {
    writeState(storageKey, next);
    bump((n) => n + 1);
  };

  const yes = async () => {
    setBusy(true);
    try {
      await onYes();
      track("prompt_accepted", { prompt: promptKind });
      settle({ date: today, done: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="scrim scrim-dialog">
      <div className="sheet sheet-dialog prompt-dialog">
        <h2>
          {icon} {title}
        </h2>
        <div className="sub">{body}</div>
        <div className="prompt-actions">
          <button className="btn btn-pl" disabled={busy} onClick={yes}>
            {busy ? "Saving…" : yesLabel}
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => {
              track("prompt_dismissed", { prompt: promptKind });
              settle({ date: today, done: true });
            }}
          >
            No
          </button>
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => {
              track("prompt_snoozed", { prompt: promptKind });
              settle({ date: today, snoozeUntil: Date.now() + snoozeMs });
            }}
          >
            {remindLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Demo-clock-aware "minutes since Dubai midnight" — scrubbing the demo hour previews the prompts too. */
function useEffectiveMinutesOfDay(): number {
  const { nowMs, demoHour, effectiveHour } = useApp();
  return effectiveHour * 60 + (demoHour == null ? dubaiMinute(nowMs) : 0);
}

/** 18:00 — "free for evening coverage tonight?" Yes toggles the §4 Rule 3 switch on. Remind: 1 hour. */
export function EveningCoveragePrompt({ settings }: { settings?: CoverageSettings | null }) {
  const { actor, setActor, nowMs } = useApp();
  const minutes = useEffectiveMinutesOfDay();
  const cov = settings ?? DEFAULT_COVERAGE;
  // Prompt window from Coverage settings (defaults 18:00–22:00) — late enough
  // that an evening ask still makes sense, without greeting a night-owl login
  // at 1am. Weekdays only (Mon–Fri Dubai) — no nagging on the weekend.
  const inWindow =
    !isDubaiWeekend(nowMs) && minutes >= cov.eveningPromptStartMin && minutes < cov.eveningPromptEndMin && !actor.eveningCoverage;
  return (
    <PromptDialog
      icon="🌙"
      title="Evening coverage tonight?"
      body="Are you free to cover this evening? Yes turns your evening-coverage toggle on — you can switch it off anytime."
      yesLabel="Yes, I'm free"
      remindLabel={`Remind me in ${cov.eveningSnoozeMin} min`}
      storageKey={`ct-prompt-evening-${actor.id}`}
      promptKind="evening"
      inWindow={inWindow}
      snoozeMs={cov.eveningSnoozeMin * 60 * 1000}
      onYes={async () => {
        const updated = await api.patch<Person>("/people/me/evening-coverage", { eveningCoverage: true });
        setActor(updated);
      }}
    />
  );
}

/** 12:30 — "going for lunch?" Yes toggles Out to Lunch on (no new allocations; red "Lunch" on the ranking). Remind: 30 minutes. */
export function LunchPrompt({ settings }: { settings?: CoverageSettings | null }) {
  const { actor, setActor, nowMs } = useApp();
  const minutes = useEffectiveMinutesOfDay();
  const cov = settings ?? DEFAULT_COVERAGE;
  // Prompt window from Coverage settings (defaults 12:30–14:30), weekdays only.
  const inWindow =
    !isDubaiWeekend(nowMs) && minutes >= cov.lunchPromptStartMin && minutes < cov.lunchPromptEndMin && !actor.outToLunch;
  return (
    <PromptDialog
      icon="🍱"
      title="Going for lunch?"
      body="Yes sets you Out to Lunch — no new projects will be allocated to you until you toggle it off. Your current work stays yours."
      yesLabel="Yes, I'm off to lunch"
      remindLabel={`Remind me in ${cov.lunchSnoozeMin} min`}
      storageKey={`ct-prompt-lunch-${actor.id}`}
      promptKind="lunch"
      inWindow={inWindow}
      snoozeMs={cov.lunchSnoozeMin * 60 * 1000}
      onYes={async () => {
        const updated = await api.patch<Person>("/people/me/lunch", { outToLunch: true });
        setActor(updated);
      }}
    />
  );
}
