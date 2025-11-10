// scripts/igPublish.js
import fetch from "node-fetch";
import crypto from "node:crypto";
import { renderSocialImage } from "./renderSocialImage.js";

/**
 * Instagram publishing via Page token (no IG_ACCESS_TOKEN).
 * Local render (sharp) → signed Cloudinary upload (binary) → IG post.
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

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "";
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";

function requireEnv(name, val) { if (!val) throw new Error(`Missing env: ${name}`); }

function normalizeHashtags(s) {
  if (!s) return "";
  const parts = s.split(/[,\s]+/g).map(t => t.trim()).filter(Boolean);
  return parts.map(t => (t.startsWith("#") ? t : `#${t.replace(/[^\w]/g, "")}`)).join(" ");
}

function buildCaption() {
  const parts = [POST_TITLE, POST_EXCERPT, normalizeHashtags(POST_TAGS), POST_URL]
    .map(x => (x || "").trim())
    .filter(Boolean);
  return parts.join("\n\n").slice(0, 2200);
}

async function signedCloudinaryUploadJpgBuffer(buf, { folder = "social_overlayed", publicId = "" } = {}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const format = "jpg";
  const params = { folder, format, timestamp };

  // Build signature (alphabetical by key)
  const toSign = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join("&") + CLOUDINARY_API_SECRET;
  const signature = crypto.createHash("sha1").update(toSign).digest("hex");

  const fileDataUri = `data:image/jpeg;base64,${buf.toString("base64")}`;
  const form = new URLSearchParams({
    file: fileDataUri,
    api_key: CLOUDINARY_API_KEY,
    timestamp: String(timestamp),
    folder,
    format,
    signature,
    ...(publicId ? { public_id: publicId } : {}),
  });

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  const json = await res.json();
  if (!res.ok || !json.secure_url) {
    throw new Error(`Cloudinary binary upload failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.secure_url; // stable .jpg URL
}

async function getPageToken() {
  const r = await fetch(`https://graph.facebook.com/v24.0/me/accounts?access_token=${USER_LONG_TOKEN}`);
  const j = await r.json();
  if (!j?.data) throw new Error(`me/accounts failed: ${JSON.stringify(j)}`);
  const page = j.data.find(p => p.id === PAGE_ID);
  if (!page?.access_token) throw new Error(`PAGE_TOKEN not found for PAGE_ID=${PAGE_ID}.`);
  return page.access_token;
}

async function getInstagramUserId({ pageId, pageToken }) {
  const r = await fetch(`https://graph.facebook.com/v24.0/${pageId}?fields=connected_instagram_account&access_token=${pageToken}`);
  const j = await r.json();
  const igId = j?.connected_instagram_account?.id;
  if (!igId) throw new Error(`connected_instagram_account not found for PAGE_ID=${pageId}. ${JSON.stringify(j)}`);
  return igId;
}

async function createMediaContainer({ igUserId, pageToken, mediaUrl, caption, isVideo }) {
  const endpoint = `https://graph.facebook.com/v24.0/${igUserId}/media`;
  const params = new URLSearchParams({ access_token: pageToken, caption: caption || "" });
  if (isVideo) params.set("video_url", mediaUrl);
  else params.set("image_url", mediaUrl);
  const r = await fetch(endpoint, { method: "POST", body: params });
  const j = await r.json();
  if (!r.ok || !j.id) throw new Error(`IG create container failed: ${r.status} ${JSON.stringify(j)}`);
  return j.id;
}

async function publishMedia({ igUserId, pageToken, creationId }) {
  const r = await fetch(`https://graph.facebook.com/v24.0/${igUserId}/media_publish`, {
    method: "POST",
    body: new URLSearchParams({ access_token: pageToken, creation_id: creationId }),
  });
  const j = await r.json();
  if (!r.ok || !j.id) throw new Error(`IG media_publish failed: ${r.status} ${JSON.stringify(j)}`);
  return j.id;
}

async function main() {
  requireEnv("PAGE_ID", PAGE_ID);
  requireEnv("FB_LONG_USER_TOKEN", USER_LONG_TOKEN);
  requireEnv("MEDIA_URL", MEDIA_URL);
  requireEnv("CLOUDINARY_CLOUD_NAME", CLOUDINARY_CLOUD_NAME);
  requireEnv("CLOUDINARY_API_KEY", CLOUDINARY_API_KEY);
  requireEnv("CLOUDINARY_API_SECRET", CLOUDINARY_API_SECRET);

  if (IS_VIDEO) {
    throw new Error("Video flow not implemented in this pivot. Set IS_VIDEO=false or extend to video.");
  }

  const caption = buildCaption();
  const title = SOCIAL_TITLE || POST_TITLE || (caption || "").split("\n")[0] || "";

  // 1080x1350  (use 1080x1080 if you prefer square)
  const jpgBuffer = await renderSocialImage(MEDIA_URL, { width: 1080, height: 1350, title, sub: "SWIPE FOR A SNEAK PEEK" });
  const finalUrl = await signedCloudinaryUploadJpgBuffer(jpgBuffer);

  const pageToken = await getPageToken();
  const igUserId = await getInstagramUserId({ pageId: PAGE_ID, pageToken });

  const creationId = await createMediaContainer({ igUserId, pageToken, mediaUrl: finalUrl, caption, isVideo: false });
  const mediaId = await publishMedia({ igUserId, pageToken, creationId });

  console.log(JSON.stringify({ ok: true, igMediaId: mediaId, finalUrl }, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
