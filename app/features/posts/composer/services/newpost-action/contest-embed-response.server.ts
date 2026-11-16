/**
 * When the composer is embedded (e.g. contest creation), return JSON instead of
 * redirecting to /dashboard/compose so the host page stays mounted.
 */

import { data } from "@remix-run/node";

import { getPostById } from "~/features/posts/server";

export function isContestEmbedRequest(formData: FormData): boolean {
  return String(formData.get("_embedContext") ?? "") === "contest";
}

export async function jsonContestEmbedPost(userId: string, postId: string) {
  const post = await getPostById({ id: postId, userId });
  if (!post) {
    return data({ error: "Post not found after publish" }, { status: 500 });
  }
  return {
    ok: true,
    embedContext: "contest" as const,
    postId: post.id,
    nostrEventId: post.nostrEventId,
    caption: post.caption,
    publishedAt:
      post.publishedAt instanceof Date ? post.publishedAt.toISOString() : null,
  };
}
