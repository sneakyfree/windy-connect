/**
 * Bundle refresh — rotate credentials before expiry without re-doing OAuth.
 *
 * The CLI calls this with its existing EPT (proving identity); we re-mint the
 * service blocks and return a fresh bundle. v1 stub.
 */

import type { Env } from "../index";
import { json } from "../index";

export async function handleBundleRefresh(_req: Request, _env: Env): Promise<Response> {
  return json(
    {
      error: "not_implemented",
      detail:
        "v1 bundles are short-lived (30d default). Re-run `windy connect` to renew. " +
        "Refresh endpoint will be wired once Eternitas EPT renewal contract is final.",
    },
    501,
  );
}
