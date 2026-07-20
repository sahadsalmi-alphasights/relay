import { Pool, type PoolClient } from "pg";
import { config } from "./config";

export const pool = new Pool({ connectionString: config.databaseUrl });

/**
 * Anything that can run a query — the shared pool, or a single client inside a
 * transaction. Repository functions accept this (defaulting to `pool`) so the
 * same function works standalone or as part of a larger atomic unit.
 */
export type Queryable = Pool | PoolClient;

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
