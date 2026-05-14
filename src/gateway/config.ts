import type { ChannelConfig, GatewayEnv } from "./types";

export function getChannelConfig(env: GatewayEnv, channelKey: string): ChannelConfig | undefined {
  const config = JSON.parse(env.CHANNEL_CONFIG_JSON || "{}") as Record<string, ChannelConfig>;
  return config[channelKey];
}

export function adminTokens(env: GatewayEnv): string[] {
  return [env.ADMIN_TOKEN, env.DASHBOARD_API_TOKEN]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}
