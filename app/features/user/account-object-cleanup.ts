/**
 * Decides which object-storage keys belong to one account and are not shared.
 * It does not call storage and it does not treat Blossom or third-party URLs
 * as owned.
 */

export interface OwnedObjectCandidate {
  url: string;
  key: string | null;
}

export interface ObjectDeletionPlan {
  deleteKeys: string[];
  skippedShared: string[];
  skippedForeign: number;
}

const SAFE_USER_ID = /^[A-Za-z0-9_-]+$/;

export function ownedAccountObjectKey(input: {
  url: string;
  userId: string;
  bucket?: string;
  region?: string;
  cdnBase?: string;
}): string | null {
  if (!SAFE_USER_ID.test(input.userId)) return null;
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password || parsed.protocol === "javascript:") {
    return null;
  }
  const key = keyFromUrl(parsed, input);
  if (!key) return null;
  const prefix = `clients/${input.userId}/`;
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  if (!rest) return null;
  const parts = rest.split("/");
  if (
    parts.some(
      (part) =>
        part.length === 0 ||
        part === "." ||
        part === ".." ||
        part.includes("\\")
    )
  ) {
    return null;
  }
  return key;
}

function keyFromUrl(
  url: URL,
  input: { bucket?: string; region?: string; cdnBase?: string }
): string | null {
  const host = url.hostname.toLowerCase();
  let path = url.pathname.replace(/^\/+/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    return null;
  }
  const bucket = input.bucket?.trim();
  const region = input.region?.trim();
  const cdnBase = input.cdnBase?.trim();
  if (cdnBase) {
    try {
      const cdn = new URL(cdnBase);
      if (host === cdn.hostname.toLowerCase()) return path;
    } catch {
      return null;
    }
  }
  if (!bucket || !region) return null;
  if (host === `${bucket}.${`s3.${region}.amazonaws.com`}`.toLowerCase())
    return path;
  const pathStyle = `s3.${region}.amazonaws.com`.toLowerCase();
  const prefix = `${bucket}/`;
  if (host === pathStyle && path.startsWith(prefix))
    return path.slice(prefix.length);
  return null;
}

export function planOwnedObjectDeletion(input: {
  userId: string;
  urls: readonly string[];
  sharedUrls: ReadonlySet<string>;
  bucket?: string;
  region?: string;
  cdnBase?: string;
}): ObjectDeletionPlan {
  const deleteKeys: string[] = [];
  const skippedShared: string[] = [];
  let skippedForeign = 0;
  const seen = new Set<string>();

  for (const url of input.urls) {
    const key = ownedAccountObjectKey({
      url,
      userId: input.userId,
      bucket: input.bucket,
      region: input.region,
      cdnBase: input.cdnBase,
    });
    if (!key) {
      skippedForeign += 1;
      continue;
    }
    if (input.sharedUrls.has(url) || url.length < 16) {
      skippedShared.push(key);
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    deleteKeys.push(key);
  }

  return { deleteKeys, skippedShared, skippedForeign };
}
