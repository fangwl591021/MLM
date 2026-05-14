import { fetchWetwMembers, fetchWetwPoints } from "./wetw";
import type { GatewayEnv } from "./types";

export async function syncMembers(env: GatewayEnv, members?: unknown[]): Promise<number> {
  const rows = members ?? await fetchWetwMembers(env);
  let count = 0;
  for (const raw of rows as Record<string, unknown>[]) {
    const memberRef = String(raw.member_ref ?? raw.memberRef ?? raw.id ?? "");
    if (!memberRef) continue;
    await env.DB.prepare(
      `INSERT INTO crm_members (member_ref, name, phone, email, level, source, source_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(member_ref)
       DO UPDATE SET name = excluded.name, phone = excluded.phone, email = excluded.email,
         level = excluded.level, source = excluded.source, source_json = excluded.source_json,
         updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(
        memberRef,
        String(raw.name ?? raw.display_name ?? ""),
        String(raw.phone ?? raw.mobile ?? ""),
        String(raw.email ?? ""),
        String(raw.level ?? raw.rank ?? ""),
        String(raw.source ?? "wetw"),
        JSON.stringify(raw),
      )
      .run();
    count += 1;
  }
  return count;
}

export async function readWetwPoints(env: GatewayEnv): Promise<unknown[]> {
  return fetchWetwPoints(env);
}
