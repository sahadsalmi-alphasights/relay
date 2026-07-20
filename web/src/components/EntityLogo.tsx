import { useState } from "react";
import { CLIENT_ENTITY_MAP } from "../lib/format";

/**
 * Client-entity logo chip for card title bars. Tries the firm's real logo
 * (logo.clearbit.com/<domain>, fetched by the browser — nothing bundled);
 * if it can't load (offline, blocked, unknown domain) it falls back to a
 * monogram chip in the firm's brand colour, so the card never looks broken.
 */
export default function EntityLogo({ entity, size = 26 }: { entity: number; size?: number }) {
  const meta = CLIENT_ENTITY_MAP[entity];
  const [failed, setFailed] = useState(false);

  if (!meta) return null;

  if (meta.domain && !failed) {
    return (
      <img
        className="entity-logo"
        src={`https://logo.clearbit.com/${meta.domain}`}
        alt={meta.name}
        title={meta.name}
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
        loading="lazy"
      />
    );
  }
  return (
    <span
      className="entity-mono"
      title={meta.name}
      style={{ width: size, height: size, background: meta.brand, fontSize: Math.round(size * 0.34) }}
    >
      {meta.mono}
    </span>
  );
}
