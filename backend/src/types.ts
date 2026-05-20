/**
 * Shared types — mirrors the Eternitas Agent Credentials Bundle spec v1
 * (../docs/bundle-spec-v1.md). Keep in sync with src/windy_connect/bundle.py.
 */

export type Tier = "free" | "credentialed";

export interface Issuer {
  name: string;
  url: string;
  icon?: string;
}

export interface EternitasBlock {
  ept: string;
  passport: string;
  operator_id: string;
  clearance_level: "registered" | "verified" | "cleared" | "top_secret" | "eternal";
  integrity_band: "critical" | "poor" | "fair" | "good" | "exceptional";
  jwks_url: string;
  revocation_check_url?: string;
}

export interface MatrixChat {
  kind: "matrix";
  homeserver: string;
  matrix_user_id: string;
  access_token: string;
  device_id: string;
  default_room_id?: string;
}

export interface MailEndpoint {
  host: string;
  port: number;
  tls: "implicit" | "starttls" | "none";
  username: string;
  password: string;
}

export interface JmapEndpoint {
  endpoint: string;
  account_id: string;
  username: string;
  password: string;
}

export interface MailBlock {
  address: string;
  display_name?: string;
  imap?: MailEndpoint;
  smtp?: MailEndpoint;
  jmap?: JmapEndpoint;
}

export interface OpenAICompatibleMind {
  kind: "openai-compatible";
  base_url: string;
  api_key: string;
  default_model?: string;
  models_endpoint?: string;
}

export interface Bundle {
  bundle_version: string;
  issuer: Issuer;
  issued_at: string;
  expires_at: string;
  refresh_url?: string;
  eternitas?: EternitasBlock;
  windy_chat?: MatrixChat;
  windy_mail?: MailBlock;
  windy_mind?: OpenAICompatibleMind;
  tier: Tier;
}

/** State stored against a device_code while we wait for the user to sign in. */
export interface DeviceSession {
  device_code: string;
  user_code: string;
  tier: Tier;
  status: "pending" | "approved" | "denied" | "expired";
  bundle?: Bundle;
  google_sub?: string;     // populated after Google sign-in
  google_email?: string;
  created_at: string;
  expires_at: string;
}
