/**
 * Agent skill discovery + content endpoints.
 *
 * /.well-known/skills/index.json
 *     → catalog of skills published at this domain. Hermes Agent (Nous
 *       Research) auto-discovers skills from any domain that serves this
 *       endpoint. Response schema mirrors clawhub.ai/api/v1/skills so both
 *       agent families can consume the same JSON.
 *
 * /.well-known/skills/windy-access/SKILL.md
 *     → the actual markdown skill body. Embedded into the Worker bundle from
 *       skills/windy-access/SKILL.md via wrangler's [[rules]] Text loader.
 *       Hosting from the Worker (not raw GitHub) makes discovery work
 *       regardless of repo visibility.
 *
 * The index points at BOTH the Worker-hosted skill_md_url (primary, always
 * works) AND a GitHub raw/tarball URL (fallback, requires the repo to be
 * public). Hermes / ClawHub clients can use whichever they prefer.
 */

import type { Env } from "../index";

// @ts-expect-error wrangler text-loader gives us the file contents as a string
import skillMd from "../../../skills/windy-access/SKILL.md";

const SKILL_VERSION = "0.3.1";
const REPO = "sneakyfree/windy-connect";

export async function handleSkillsIndex(_req: Request, _env: Env): Promise<Response> {
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
        updatedAt: 1747785600000, // 2026-05-20T02:40:00Z
        latestVersion: {
          version: SKILL_VERSION,
          // Primary — always works because the Worker serves the file itself.
          skill_md_url: `https://api.windyconnect.com/.well-known/skills/windy-access/SKILL.md`,
          // Fallbacks — work once the source repo is public.
          github_raw_url: `https://raw.githubusercontent.com/${REPO}/v${SKILL_VERSION}/skills/windy-access/SKILL.md`,
          github_archive_url: `https://github.com/${REPO}/archive/refs/tags/v${SKILL_VERSION}.tar.gz`,
          github_archive_root: `windy-connect-${SKILL_VERSION}/skills/windy-access/`,
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
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}

export async function handleSkillMd(_req: Request, _env: Env): Promise<Response> {
  return new Response(skillMd as string, {
    status: 200,
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*",
    },
  });
}
