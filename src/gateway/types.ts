export interface GatewayEnv {
  DB: D1Database;
  CHANNEL_CONFIG_JSON?: string;
  ADMIN_TOKEN?: string;
  DASHBOARD_API_TOKEN?: string;
  POINT_API_KEY?: string;
  WETW_MEMBERS_URL?: string;
  WETW_POINTS_URL?: string;
  WETW_POINT_INSERT_URL?: string;
  WETW_SHOP_ID?: string;
  WETW_POINTS_MAX_PAGES?: string;
}

export interface ChannelConfig {
  channelSecret: string;
  channelAccessToken?: string;
  forwardUrl?: string;
  floor?: "main" | "admin";
  label?: string;
}

export interface LineWebhookPayload {
  destination?: string;
  events?: LineWebhookEvent[];
}

export interface LineWebhookEvent {
  type?: string;
  replyToken?: string;
  timestamp?: number;
  source?: {
    type?: string;
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  message?: {
    type?: string;
    text?: string;
    id?: string;
  };
}
