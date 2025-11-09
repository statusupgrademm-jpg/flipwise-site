// scripts/igPublish.js
import fetch from "node-fetch";
import { buildSocialImageUrl } from "./socialImage.js";

/**
 * Publishes a single post to Instagram via the Graph API.
 * - If IS_VIDEO=true, posts the original video URL.
 * - If image, applies 70% dark overlay + white heading via Cloudinary transform.
 *
 * Required env:
 *   IG_USER_ID          Instagram Business/Creator User ID
 *   IG_ACCESS_TOKEN     Valid token with permissions for the IG user
 *
 * Content env (same as your existing flow):
 *   MEDIA_URL           Original image/video URL (from your pipeline)
 *   POST_TITLE          Title for caption + overlay heading
 *   POST_EXCERPT        Optional extra text for caption
 *   POST_URL            Optional link (will be plain text in caption)
 *   POST_TAGS           Optional CSV or space-separated tags (converted to hashtags)
 *   IS_VIDEO            "true" to treat as video, else image
 *
 * Optional:
 *   SOCIAL_TITLE        Override heading text on the overlay (uses POST_TITLE by default)
 */

const IG_USER_ID = process.env.IG_USER_ID;
const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;

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
  // Accept CSV or space-separated; ensure each starts with '#', remove punctuation noise
  const parts = s
    .split(/[,\s]+/g)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith("#") ? t : `#${t.replace(/[^\w]/g, "")}`));
  return parts.length ? parts.join(" ") : "";
}

function buildCaption() {
  const hashtags = normalizeHashtags(POST_TAGS);
  const chunks = [
    POST_TITLE,
    POST_EXCERPT,
    hashtags,
    POST_URL, // IG will show it as text; that's fine for reference
  ]
    .map((c) => (c || "").trim())
    .filter(Boolean);
  // Keep caption readable but compact
  return chunks.join("\n\n").trim().slice(0, 2200); // IG caption limit safeguard
}

function safeBuildSocial(baseImageUrl, caption) {
  // Only transform IMAGES; videos must pass through unchanged
  if (!baseImageUrl) return "";
  try {
    const title =
      SOCIAL_TITLE || POST_TITLE || (caption || "").split("\n")[0] || "";
    return buildSocialImageUrl(baseImageUrl, title, {
      sub: "Swipe for a sneak peek",
    });
  } catch (e) {
    console.warn("[igPublish] overlay build failed, falling back:", e.message);
    return baseImageUrl;
  }
}

async function createMediaContainer({ userId, accessToken, mediaUrl, caption, isVideo }) {
  const endpoint = `https://graph.facebook.com/v24.0/${userId}/media`;

  const params = new URLSearchParams({
    access_token: accessToken,
    caption: caption || "",
  });

  if (isVideo) {
    // Video container
    params.set("video_url", mediaUrl);
    // (Optional) You can set "media_type=VIDEO" but IG Graph infers from video_url.
  } else {
    // Image container
    params.set("image_url", mediaUrl);
  }

  const r = await fetch(endpoint, { method: "POST", body: params });
  const j = await r.json();
  if (!r.ok || !j.id) {
    throw new Error(
      `IG create container failed: ${r.status} ${JSON.stringify(j)}`
    );
  }
  return j.id;
}

async function publishMedia({ userId, accessToken, creationId }) {
  const endpoint = `https://graph.facebook.com/v24.0/${userId}/media_publish`;
  const params = new URLSearchParams({
    access_token: accessToken,
    creation_id: creationId,
  });

  const r = await fetch(endpoint, { method: "POST", body: params });
  const j = await r.json();
  if (!r.ok || !j.id) {
    throw new Error(
      `IG media_publish failed: ${r.status} ${JSON.stringify(j)}`
    );
  }
  return j.id;
}

async function main() {
  requireEnv("IG_USER_ID", IG_USER_ID);
  requireEnv("IG_ACCESS_TOKEN", IG_ACCESS_TOKEN);

  const caption = buildCaption();

  // Build final media URL:
  // - If video → pass original URL
  // - If image → apply overlay + heading
  const finalMediaUrl = IS_VIDEO
    ? MEDIA_URL
    : safeBuildSocial(MEDIA_URL, caption);

  if (!finalMediaUrl) {
    throw new Error("MEDIA_URL is empty after processing.");
  }

  const creationId = await createMediaContainer({
    userId: IG_USER_ID,
    accessToken: IG_ACCESS_TOKEN,
    mediaUrl: finalMediaUrl,
    caption,
    isVideo: IS_VIDEO,
  });

  const mediaId = await publishMedia({
    userId: IG_USER_ID,
    accessToken: IG_ACCESS_TOKEN,
    creationId,
  });

  console.log(JSON.stringify({ ok: true, igMediaId: mediaId }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
