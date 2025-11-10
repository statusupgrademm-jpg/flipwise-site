// scripts/igPublish.js
import fetch from "node-fetch";
import { buildSocialImageUrl } from "./socialImage.js";

/**
 * Instagram publishing via Page token (no IG_ACCESS_TOKEN required).
 *
 * Required env:
 *   PAGE_ID               Facebook Page ID that's connected to the IG account
 *   FB_LONG_USER_TOKEN    Long-lived FB USER access token (with perms)
 *
 * Content env (same as before):
 *   MEDIA_URL             Image/video URL to post
 *   POST_TITLE            Title (also used for overlay heading)
 *   POST_EXCERPT          Optional extra text for caption
 *   POST_URL              Optional link (will be plain text in caption)
 *   POST_TAGS             Optional CSV or space-separated tags
 *   IS_VIDEO              "true" to treat as video, else image
 *   SOCIAL_TITLE          Optional explicit overlay heading
 *
 * Notes:
 * - We fetch IG_USER_ID from the Page using the Page token:
 *   GET /{PAGE_ID}?fields=connected_instagram_account
 * - We then call /{ig_user_id}/media and /media_publish using the Page token.
 */

const PAGE_ID = process.env.PAGE_ID;
const USER_LONG_TOKEN = process.env.FB_LONG_USER_TOKEN; // long-lived USER token

const MEDIA_URL = process.env.MEDIA_URL || "";
const POST_TITLE = process.env.POST_TITLE || "";
const POST_EXCERPT = process.env.POST_EXCERPT || "";
const POST_URL = process.env.POST_URL || "";
const POST_TAGS = process.env.POST_TAGS || "";
const IS_VIDEO =
  String(process.env.IS_VIDEO || "false").toLowerCase() === "true";
const SOCIAL_TITLE = process.env.SOCIAL_TITLE || "";

function requireEnv(name, val) {
  if (!val) throw new Error(`Missing env: ${name}`);
}

function normalizeHashtags(s) {
  if (!s) return "";
  const parts = s
    .split(/[,\s]+/g)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t.replace(/[^\w]/g, "")}`));
  return parts.length ? parts.join(" ") : "";
}

function buildCaption() {
  const hashtags = normalizeHashtags(POST_TAGS);
  const chunks = [POST_TITLE, POST_EXCERPT, hashtags, POST_URL]
    .map((c) => (c || "").trim())
    .filter(Boolean);
  return chunks.join("\n\n").trim().slice(0, 2200); // IG caption limit
}

function safeBuildSocial(baseImageUrl, caption) {
  if (!baseImageUrl) return "";
  try {
    const title = SOCIAL_TITLE || POST_TITLE || (caption || "").split("\n")[0] || "";
    return buildSocialImageUrl(baseImageUrl, title, { sub: "Swipe for a sneak peek" });
  } catch (e) {
    console.warn("[igPublish] overlay build failed, falling back:", e.message);
    return baseImageUrl;
  }
}

async function getPageToken() {
  // Long-lived USER token -> list Pages -> find ours -> return Page token
  const r = await fetch(
    `https://graph.facebook.com/v24.0/me/accounts?access_token=${USER_LONG_TOKEN}`
  );
  const j = await r.json();
  if (!j?.data) throw new Error(`me/accounts failed: ${JSON.stringify(j)}`);
  const page = j.data.find((p) => p.id === PAGE_ID);
  if (!page?.access_token) {
    throw new Error(
      `PAGE_TOKEN not found for PAGE_ID=${PAGE_ID}. me/accounts=${JSON.stringify(j)}`
    );
  }
  return page.access_token;
}

async function getInstagramUserId({ pageId, pageToken }) {
  const r = await fetch(
    `https://graph.facebook.com/v24.0/${pageId}?fields=connected_instagram_account&access_token=${pageToken}`
  );
  const j = await r.json();
  const igId = j?.connected_instagram_account?.id;
  if (!igId) {
    throw new Error(
      `connected_instagram_account not found for PAGE_ID=${pageId}. Response=${JSON.stringify(j)}`
    );
  }
  return igId;
}

async function createMediaContainer({ igUserId, pageToken, mediaUrl, caption, isVideo }) {
  const endpoint = `https://graph.facebook.com/v24.0/${igUserId}/media`;
  const params = new URLSearchParams({
    access_token: pageToken,
    caption: caption || "",
  });
  if (isVideo) {
    params.set("video_url", mediaUrl);
  } else {
    params.set("image_url", mediaUrl);
  }
  const r = await fetch(endpoint, { method: "POST", body: params });
  const j = await r.json();
  if (!r.ok || !j.id) {
    throw new Error(`IG create container failed: ${r.status} ${JSON.stringify(j)}`);
  }
  return j.id;
}

async function publishMedia({ igUserId, pageToken, creationId }) {
  const endpoint = `https://graph.facebook.com/v24.0/${igUserId}/media_publish`;
  const params = new URLSearchParams({
    access_token: pageToken,
    creation_id: creationId,
  });
  const r = await fetch(endpoint, { method: "POST", body: params });
  const j = await r.json();
  if (!r.ok || !j.id) {
    throw new Error(`IG media_publish failed: ${r.status} ${JSON.stringify(j)}`);
  }
  return j.id;
}

async function main() {
  requireEnv("PAGE_ID", PAGE_ID);
  requireEnv("FB_LONG_USER_TOKEN", USER_LONG_TOKEN);
  if (!MEDIA_URL) throw new Error("Missing env: MEDIA_URL");

  const caption = buildCaption();

  // For images, apply overlay; for videos, pass through
  const finalMediaUrl = IS_VIDEO ? MEDIA_URL : safeBuildSocial(MEDIA_URL, caption);

  const pageToken = await getPageToken();
  const igUserId = await getInstagramUserId({ pageId: PAGE_ID, pageToken });

  const creationId = await createMediaContainer({
    igUserId,
    pageToken,
    mediaUrl: finalMediaUrl,
    caption,
    isVideo: IS_VIDEO,
  });

  const mediaId = await publishMedia({
    igUserId,
    pageToken,
    creationId,
  });

  console.log(JSON.stringify({ ok: true, igMediaId: mediaId }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
