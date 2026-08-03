import { useApp } from "../state/AppContext";
import { initials } from "../lib/format";

// The statuses that count as "out", in display order, with an emoji.
const OUT_GROUPS: { status: string; label: string; emoji: string }[] = [
  { status: "On vacation", label: "On vacation", emoji: "🌴" },
  { status: "Sick", label: "Sick", emoji: "🤒" },
  { status: "Offline", label: "Offline", emoji: "⚪" },
];

/**
 * Settings → Who is out. A read-only, at-a-glance list of everyone who isn't
 * Available right now, grouped by status. People the BambooHR sync put Offline
 * for leave are tagged so they're distinguishable from a manual Offline.
 */
export default function WhoIsOut() {
  const { people, teamNameOf } = useApp();

  const active = people.filter((p) => !p.deactivatedAt && !p.isGhost);
  const outCount = active.filter((p) => p.status !== "Available").length;

  return (
    <>
      <div className="scope-note">
        Who's currently unavailable across the BU — anyone not set to “Available”. Leave synced from BambooHR shows as Offline with a leave tag.
      </div>

      {outCount === 0 && <div className="empty">Everyone's available right now. 🎉</div>}

      {OUT_GROUPS.map((g) => {
        const rows = active
          .filter((p) => p.status === g.status)
          .sort((a, b) => a.name.localeCompare(b.name));
        if (rows.length === 0) return null;
        return (
          <div className="card cs-card" key={g.status}>
            <div className="cs-head">
              {g.emoji} {g.label} <span className="mini team" style={{ marginLeft: 6 }}>{rows.length}</span>
            </div>
            {rows.map((p) => (
              <div className="cs-row" key={p.id}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="avatar">{initials(p.name)}</span>
                  <div>
                    <div className="cs-rl">{p.name}</div>
                    <div className="cs-rs">
                      {teamNameOf(p.teamId)}
                      {p.practiceArea ? ` · ${p.practiceArea}` : ""}
                    </div>
                  </div>
                </div>
                <div className="cs-controls">
                  {p.status === "Offline" && p.hrOfflineAt && <span className="mini free">🗓 BambooHR leave</span>}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
