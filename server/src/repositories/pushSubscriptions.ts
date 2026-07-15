import { pool } from "../db";

export interface PushSubscriptionRow {
  id: string;
  personId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const SELECT = `SELECT id, person_id AS "personId", endpoint, p256dh, auth FROM push_subscription`;

export async function listForPerson(personId: string): Promise<PushSubscriptionRow[]> {
  const { rows } = await pool.query(`${SELECT} WHERE person_id = $1`, [personId]);
  return rows;
}

/** Re-subscribing with the same endpoint (e.g. after a permission reset) replaces the old keys rather than duplicating. */
export async function upsertSubscription(
  personId: string,
  sub: { endpoint: string; p256dh: string; auth: string }
): Promise<PushSubscriptionRow> {
  const { rows } = await pool.query(
    `INSERT INTO push_subscription (person_id, endpoint, p256dh, auth)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET person_id = $1, p256dh = $3, auth = $4
     RETURNING id`,
    [personId, sub.endpoint, sub.p256dh, sub.auth]
  );
  return (await pool.query(`${SELECT} WHERE id = $1`, [rows[0].id])).rows[0];
}

export async function deleteSubscription(endpoint: string): Promise<void> {
  await pool.query(`DELETE FROM push_subscription WHERE endpoint = $1`, [endpoint]);
}

/** A push send can fail permanently (410 Gone / 404) when the browser has dropped the subscription; the caller prunes it here. */
export async function deleteSubscriptionById(id: string): Promise<void> {
  await pool.query(`DELETE FROM push_subscription WHERE id = $1`, [id]);
}
