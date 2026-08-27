import { useApp } from "../state/AppContext";
import { initials } from "../lib/format";
import { Icon, type IconName } from "./Icon";

// The "out" buckets, in display order. Offline is folded into On vacation —
// we don't surface a separate Offline section here; anyone not Available and
// not Sick shows as On vacation.
const OUT_GROUPS: { key: string; label: string; emoji: IconName; statuses: string[] }[] = [
  { key: "vacation", label: "On vacation", emoji: "palm", statuses: ["On vacation", "Offline"] },
  { key: "sick", label: "Sick", emoji: "thermometer", statuses: ["Sick"] },
];

/**
 * Settings → Who is out. A read-only, at-a-glance list of everyone who isn't
 * Available right now. Two buckets only — On vacation (incl. Offline) and Sick.
 * BambooHR-synced leave carries a tag.
 */
export default function WhoIsOut() {
  const { people, teamNameOf } = useApp();

  const active = people.filter((p) => !p.deactivatedAt && !p.isGhost);
  const outCount = active.filter((p) => p.status !== "Available").length;

  return (
    <>
      <div className="scope-note">
        Who's currently unavailable across the BU — anyone not set to “Available”. Leave synced from BambooHR shows under On vacation with a leave tag.
      </div>

      {outCount === 0 && <div className="empty">Everyone's available right now. 🎉</div>}

      {OUT_GROUPS.map((g) => {
        const rows = active
          .filter((p) => g.statuses.includes(p.status))
          .sort((a, b) => a.name.localeCompare(b.name));
        if (rows.length === 0) return null;
        return (
          <div className="card cs-card" key={g.key}>
            <div className="cs-head">
              <Icon name={g.emoji} /> {g.label} <span className="mini team" style={{ marginLeft: 6 }}>{rows.length}</span>
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
                  {p.hrOfflineAt && <span className="mini free"><Icon name="calendar" /> BambooHR leave</span>}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
