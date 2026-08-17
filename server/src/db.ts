import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, type PoolClient } from "pg";
import { config } from "./config";

export const pool = new Pool({ connectionString: config.databaseUrl });

/**
 * Anything that can run a query — the shared pool, or a single client inside a
 * transaction. Repository functions accept this (defaulting to `pool`) so the
 * same function works standalone or as part of a larger atomic unit.
 */
export type Queryable = Pool | PoolClient;

export type BusinessUnit = "consulting" | "non_consulting";

/**
 * Multi-BU (Phase 1b) — the active-BU context. Postgres RLS filters every
 * tenant table by `app.active_bu`; this is how the app sets it.
 *
 * `runWithBu` checks out one client, opens a transaction, sets the BU with
 * `set_config(..., is_local => true)` so it's scoped to that transaction and
 * auto-cleared on COMMIT/ROLLBACK — the client can never return to the pool
 * carrying a stale BU (which would be a cross-BU leak). Work inside `fn` must
 * run its queries on the context client, which `db()` returns.
 *
 * Nothing calls this yet for request traffic (the whole live app is NC, and
 * the RLS policy resolves an unset BU to 'non_consulting'), so current
 * behaviour is unchanged. It's the primitive the C BU + background jobs will
 * use once C is enabled.
 */
const buContext = new AsyncLocalStorage<{ client: PoolClient }>();

/** The current context's client when inside runWithBu, else the shared pool. */
export function db(): Queryable {
  return buContext.getStore()?.client ?? pool;
}

export async function runWithBu<T>(bu: BusinessUnit, fn: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // set_config with is_local=true == SET LOCAL, but parameterised (SET does
    // not accept placeholders). Transaction-scoped, so it never outlives fn.
    await client.query("SELECT set_config('app.active_bu', $1, true)", [bu]);
    const result = await buContext.run({ client }, fn);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run `fn` inside one BEGIN/COMMIT transaction on a single client; ROLLBACK on
 * any error. Use for multi-write operations that must be all-or-nothing (e.g.
 * creating a project plus its angles and assignments).
 */
export async function withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
