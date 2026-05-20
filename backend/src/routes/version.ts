/**
 * GET /version — deployment identity, per the ecosystem version-endpoint contract.
 *
 * Returns {service, version, commit_sha, deployed_at}. No auth, no DB, no
 * rate limit. Used by the deployed-state cron + by humans diagnosing
 * "which version am I hitting?" across the fleet.
 *
 * Reference impl: sneakyfree/eternitas PR #74 (the contract is also
 * documented in MEMORY.md at reference_version_endpoint_contract).
 *
 * commit_sha + deployed_at are baked at build time via wrangler [vars]
 * (set by backend/scripts/deploy.sh). When they're not set (e.g. wrangler
 * dev), we report "dev" / "unknown" rather than failing — /version should
 * never error.
 */

import type { Env } from "../index";

const VERSION = "0.2.2";

export async function handleVersion(_req: Request, env: Env): Promise<Response> {
  const body = {
    service: "windy-connect-orchestrator",
    version: VERSION,
    commit_sha: env.COMMIT_SHA ?? "dev",
    deployed_at: env.DEPLOYED_AT ?? "unknown",
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
    },
  });
}
