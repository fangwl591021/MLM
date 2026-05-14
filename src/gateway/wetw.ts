import type { GatewayEnv } from "./types";

export async function fetchWetwMembers(env: GatewayEnv): Promise<unknown[]> {
  return fetchWetwArray(env, env.WETW_MEMBERS_URL, "members");
}

export async function fetchWetwPoints(env: GatewayEnv): Promise<unknown[]> {
  return fetchWetwArray(env, env.WETW_POINTS_URL, "points");
}

async function fetchWetwArray(env: GatewayEnv, url: string | undefined, key: string): Promise<unknown[]> {
  if (!url) throw new Error(`${key} source url is not configured`);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (env.POINT_API_KEY) headers.Authorization = `Bearer ${env.POINT_API_KEY}`;
  const response = await fetch(url, { headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`WETW ${key} sync failed: ${response.status}`);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data[key])) return data[key];
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.items)) return data.items;
  return [];
}
