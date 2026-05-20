/**
 * /.well-known/skills/index.json — agent skill auto-discovery endpoint.
 *
 * Hermes Agent (Nous Research) auto-discovers skills from any domain that
 * serves a `/.well-known/skills/index.json`. We expose the windy-access skill
 * there so Hermes users can do:
 *
 *   hermes skills tap add windyconnect.com
 *
 * and pick up the SKILL.md without any registry signup.
 *
 * Schema mirrors what ClawHub returns for /api/v1/skills (verified by
 * inspecting the OpenClaw runtime, see [[reference_clawhub_schema]] +
 * [[reference_hermes_agent]] memories) so a single endpoint serves both
 * agent families.
 *
 * Archive URLs point at GitHub's tarball endpoint for the tagged release —
 * we don't host the zip ourselves because (a) Workers have size limits and
 * (b) GitHub already serves immutable tagged tarballs from a CDN.
 */

import type { Env } from "../index";
import { json } from "../index";

const SKILL_VERSION = "0.2.0";
const REPO = "sneakyfree/windy-connect";

export async function handleSkillsIndex(_req: Request, _env: Env): Promise<Response> {
  // ClawHub /api/v1/skills response shape, slightly extended with a download
  // URL so callers don't have to construct it.
  const body = {
    spec_version: "1.0",
    items: [
      {
        slug: "windy-access",
        displayName: "Windy Access",
        summary:
          "Wire any agent into the Windy ecosystem in one command. Auto-detects OpenClaw / Hermes / Claude Code; falls back to ~/.windy/bundle.json for any other runtime.",
        tags: { latest: SKILL_VERSION },
        stats: { downloads: 0, installsAllTime: 0, installsCurrent: 0, stars: 0, versions: 1 },
        createdAt: 1747776000000, // 2026-05-20T00:00:00Z
        updatedAt: 1747785600000, // 2026-05-20T02:40:00Z (publish day)
        latestVersion: {
          version: SKILL_VERSION,
          // GitHub serves tarballs at /<owner>/<repo>/archive/refs/tags/v<version>.tar.gz
          // The skill lives at skills/windy-access/ inside that tarball.
          archive_url: `https://github.com/${REPO}/archive/refs/tags/v${SKILL_VERSION}.tar.gz`,
          archive_root: `windy-connect-${SKILL_VERSION}/skills/windy-access/`,
          skill_md_url: `https://raw.githubusercontent.com/${REPO}/v${SKILL_VERSION}/skills/windy-access/SKILL.md`,
          changelog:
            "0.2.0 adds first-class Hermes Agent support: detection of ~/.hermes, marker-bounded writes to ~/.hermes/.env, native EMAIL_*/IMAP_*/SMTP_* wiring for Hermes's built-in mail tool.",
          license: "MIT",
        },
        metadata: {
          os: ["macos", "linux"],
          systems: ["openclaw", "hermes", "claude_code", "generic"],
        },
      },
    ],
  };

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Permissive caching: the index can be re-fetched any time without auth.
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
