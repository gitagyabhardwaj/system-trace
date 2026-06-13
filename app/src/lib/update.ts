/**
 * Update check. On an explicit user action we ask GitHub's public releases API
 * for the latest tag and compare it to the running app version. This is not
 * telemetry: nothing is sent, it only reads a public endpoint when the user
 * clicks "Check for updates". Silent auto-install (the tauri updater plugin)
 * needs a code-signing key and is tracked as a separate enhancement.
 */

import type { UpdateInfo } from "./types";
import { isTauri } from "./api";

const RELEASES_API =
  "https://api.github.com/repos/anandsundaramoorthysa/system-trace/releases/latest";
const RELEASES_PAGE =
  "https://github.com/anandsundaramoorthysa/system-trace/releases/latest";

/** Compare two dotted version strings. Returns true when `latest` > `current`. */
function isNewer(latest: string, current: string): boolean {
  const norm = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const a = norm(latest);
  const b = norm(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  // Read the running version. In Tauri this comes from the app metadata; in a
  // plain browser (design preview) we fall back to a placeholder.
  let current = "0.0.0";
  if (isTauri) {
    const { getVersion } = await import("@tauri-apps/api/app");
    current = await getVersion();
  }

  const res = await fetch(RELEASES_API, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  const json = (await res.json()) as { tag_name?: string; html_url?: string };
  const latest = (json.tag_name ?? "0.0.0").replace(/^v/, "");

  return {
    current,
    latest,
    update_available: isNewer(latest, current),
    url: json.html_url ?? RELEASES_PAGE,
  };
}
