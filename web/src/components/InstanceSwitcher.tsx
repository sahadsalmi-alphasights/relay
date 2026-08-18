import { useEffect, useState } from "react";
import { api } from "../api/client";

interface MeInstances {
  active: string;
  canSwitch: boolean;
  options: { key: string; name: string }[];
}

/**
 * Owner "view as instance" switcher — sits next to the dark-mode toggle. Only
 * shows for someone allowed to switch (owner) with more than one instance to
 * choose from. Changing it persists the choice server-side (a cookie the
 * capacity ranking / matching read) and reloads so every view re-scopes to the
 * selected instance. Non-owners never see it.
 */
export default function InstanceSwitcher() {
  const [data, setData] = useState<MeInstances | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<MeInstances>("/me/instances").then(setData).catch(() => {});
  }, []);

  if (!data || !data.canSwitch || data.options.length < 2) return null;

  const change = async (key: string) => {
    setBusy(true);
    try {
      await api.post("/me/active-instance", { key });
      window.location.reload();
    } catch {
      setBusy(false);
    }
  };

  return (
    <select
      className="theme-btn"
      style={{ width: "auto", padding: "0 6px", fontSize: 12, maxWidth: 180 }}
      value={data.active}
      disabled={busy}
      title="Viewing instance — switch to view another"
      onChange={(e) => change(e.target.value)}
    >
      {data.options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.name}
        </option>
      ))}
    </select>
  );
}
