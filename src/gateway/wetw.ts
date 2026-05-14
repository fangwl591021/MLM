import type { GatewayEnv } from "./types";

export async function fetchWetwMembers(env: GatewayEnv): Promise<unknown[]> {
  if (!env.WETW_MEMBERS_URL) throw new Error("members source url is not configured");
  if (!env.POINT_API_KEY) throw new Error("POINT_API_KEY is not configured");
  const shopId = Number(env.WETW_SHOP_ID || 216);
  const response = await fetch(env.WETW_MEMBERS_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: env.POINT_API_KEY, shop_id: shopId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`WETW members sync failed: ${response.status}`);
  if (Array.isArray(data?.data?.list)) return data.data.list;
  if (Array.isArray(data?.members)) return data.members;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

export async function fetchWetwPoints(env: GatewayEnv): Promise<unknown[]> {
  return fetchWetwPointList(env);
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

export async function fetchWetwPointList(env: GatewayEnv, options: Record<string, unknown> = {}): Promise<unknown[]> {
  if (!env.POINT_API_KEY) throw new Error("POINT_API_KEY is not configured");
  const url = env.WETW_POINTS_URL || "https://k-link.cc/index.php/wp-json/wetw-point/v1/query-user-point-list";
  const shopId = Number(options.shop_id ?? env.WETW_SHOP_ID ?? 216);
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: env.POINT_API_KEY,
      shop_id: shopId,
      page: Number(options.page ?? 1),
      per_page: Number(options.per_page ?? 100),
      max_pages: Number(options.max_pages ?? env.WETW_POINTS_MAX_PAGES ?? 5),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) throw new Error(`WETW points sync failed: ${response.status}`);
  if (Array.isArray(data?.data?.list)) return data.data.list;
  return [];
}

export async function insertWetwPoint(env: GatewayEnv, input: Record<string, unknown>): Promise<unknown> {
  if (!env.POINT_API_KEY) throw new Error("POINT_API_KEY is not configured");
  const url = env.WETW_POINT_INSERT_URL || "https://k-link.cc/index.php/wp-json/wetw-point/v1/insert-user-point";
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: env.POINT_API_KEY, shop_id: Number(env.WETW_SHOP_ID || 216), ...input }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) throw new Error(`WETW point insert failed: ${response.status}`);
  return data;
}
