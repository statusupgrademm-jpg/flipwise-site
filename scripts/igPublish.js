// scripts/igPublish.js
import fetch from "node-fetch";
import crypto from "node:crypto";

/**
 * Instagram publishing via Page token (no IG_ACCESS_TOKEN required).
 * Uses a signed Cloudinary eager upload to generate a static JPG with overlay before posting to IG.
 *
 * Required env:
 *   PAGE_ID                 Facebook Page ID connected to IG account
 *   FB_LONG_USER_TOKEN      Long-lived FB USER token
 *   CLOUDINARY_CLOUD_NAME   Cloudinary cloud name (e.g., "flipwise")
 *   CLOUDINARY_API_KEY      Cloudinary API key
 *   CLOUDINARY_API_SECRET   Cloudinary API secret
 *
 * Content env:
 *   MEDIA_URL               Base image/video URL (publicly accessible)
 *   POST_TITLE              Title (also used for overlay heading)
 *   POST_EXCERPT            Optional text
 *   POST_URL                Optional link (plain text in caption)
 *   POST_TAGS               CSV or space-separated tags
 *   IS_VIDEO                "true" to treat as video, else image
 *   SOCIAL_TITLE            Optional explicit overlay heading (overrides POST_TITLE)
 */

const PAGE_ID = process.env.PAGE_ID;
const USER_LONG_TOKEN = process.env.FB_LONG_USER_TOKEN;

const MEDIA_URL = process.env.MEDIA_URL || "";
const POST_TITLE = process.env.POST_TITLE || "";
const POST_EXCERPT = process.env.POST_EXCERPT || "";
const POST_URL = process.env.POST_URL || "";
const POST_TAGS = process.env.POST_TAGS || "";
const IS_VIDEO = String(process.env.IS_VIDEO || "false").toLowerCase() === "true";
const SOCIAL_TITLE = process.env.SOCIAL_TITLE || "";

// Cloudinary creds (needed to upload the final static image)
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "";
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";

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
  return chunks.join("\n\n").trim().slice(0, 2200);
}

/**
 * Signed eager upload: upload the ORIGINAL image to Cloudinary and generate a derived JPG
 * with overlay/text via eager transformation. Returns the static JPG URL IG will accept.
 */
async function uploadToCloudinaryWithEager(baseImageUrl, { title, sub }) {
  requireEnv("CLOUDINARY_CLOUD_NAME", CLOUDINARY_CLOUD_NAME);
  requireEnv("CLOUDINARY_API_KEY", CLOUDINARY_API_KEY);
  requireEnv("CLOUDINARY_API_SECRET", CLOUDINARY_API_SECRET);

  const folder = "social_overlayed";
  const timestamp = Math.floor(Date.now() / 1000);

  // Build the eager transformation (do not URL-encode the entire string; only the text payloads)
  const H1 = String(title || "").toUpperCase().replace(/\n/g, " ");
  const SUB = String(sub || "").toUpperCase().replace(/\n/g, " ");

  const eager =
    `c_fill,w_1080,h_1350,q_auto,f_jpg` +
    `/e_colorize:70,co_rgb:000000` +
    `/l_text:Montserrat_90_bold:${encodeURIComponent(H1)},co_rgb:ffffff,g_center,y_-80` +
    `/l_text:Montserrat_32_bold:${encodeURIComponent(SUB)},co_rgb:ffffff,g_center,y_480`;

  // Sign parameters alphabetically by key: eager, folder, timestamp
  const toSign = `eager=${eager}&folder=${folder}&timestamp=${timestamp}${CLOUDINARY_API_SECRET}`;
  const signature = crypto.createHash("sha1").update(toSign).digest("hex");

  const form = new URLSearchParams({
    file: baseImageUrl,                 // ORIGINAL image URL (no transforms)
    api_key: CLOUDINARY_API_KEY,
    timestamp: String(timestamp),
    folder,
    eager,                              // generate derived asset with overlay/text
    signature,
  });

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });

  const json = await res.json();
  if (!res.ok || !Array.isArray(json.eager) || !json.eager[0]?.secure_url) {
    throw new Error(`Cloudinary upload failed: ${res.status} ${JSON.stringify(json)}`);
  }

  return json.eager[0].secure_url; // static JPG with overlay
}

async function getPageToken() {
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
  requireEnv("MEDIA_URL", MEDIA_URL);

  const caption = buildCaption();

  // Build final media URL:
  // - Video: pass original URL
  // - Image: upload ORIGINAL with eager overlay → static JPG URL IG accepts
  let finalMediaUrl;
  if (IS_VIDEO) {
    finalMediaUrl = MEDIA_URL;
  } else {
    const title = SOCIAL_TITLE || POST_TITLE || (caption || "").split("\n")[0] || "";
    finalMediaUrl = await uploadToCloudinaryWithEager(MEDIA_URL, {
      title,
      sub: "Swipe for a sneak peek",
    });
  }

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
