// scripts/fbPublish.js
import fetch from "node-fetch";
import crypto from "node:crypto";
import { renderSocialImage } from "./renderSocialImage.js";

/**
 * Facebook Page photo post using locally rendered JPG + signed Cloudinary upload.
 */

const PAGE_ID = process.env.PAGE_ID;
const USER_LONG_TOKEN = process.env.FB_LONG_USER_TOKEN;

const FB_IMAGE_URL = process.env.FB_IMAGE_URL || ""; // base image
const FB_MESSAGE = process.env.FB_MESSAGE || "";
const SOCIAL_TITLE = process.env.SOCIAL_TITLE || "";

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "";
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";

function requireEnv(name, val) { if (!val) throw new Error(`Missing env: ${name}`); }

async function signedCloudinaryUploadJpgBuffer(buf, { folder = "social_overlayed", publicId = "" } = {}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const format = "jpg";
  const params = { folder, format, timestamp };
  const toSign = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join("&") + CLOUDINARY_API_SECRET;
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
  return json.secure_url;
}

async function getPageToken() {
  const r = await fetch(`https://graph.facebook.com/v24.0/me/accounts?access_token=${USER_LONG_TOKEN}`);
  const j = await r.json();
  if (!j?.data) throw new Error(`me/accounts failed: ${JSON.stringify(j)}`);
  const page = j.data.find(p => p.id === PAGE_ID);
  if (!page?.access_token) throw new Error(`PAGE_TOKEN not found for PAGE_ID=${PAGE_ID}.`);
  return page.access_token;
}

async function postPhoto({ pageId, pageToken, imageUrl, caption }) {
  const form = new URLSearchParams({ access_token: pageToken, url: imageUrl, caption: caption || "" });
  const r = await fetch(`https://graph.facebook.com/v24.0/${pageId}/photos`, { method: "POST", body: form });
  const j = await r.json();
  if (!r.ok || !j.id) throw new Error(`FB /photos failed: ${r.status} ${JSON.stringify(j)}`);
  return j.id;
}

async function main() {
  requireEnv("PAGE_ID", PAGE_ID);
  requireEnv("FB_LONG_USER_TOKEN", USER_LONG_TOKEN);
  requireEnv("FB_IMAGE_URL", FB_IMAGE_URL);
  requireEnv("CLOUDINARY_CLOUD_NAME", CLOUDINARY_CLOUD_NAME);
  requireEnv("CLOUDINARY_API_KEY", CLOUDINARY_API_KEY);
  requireEnv("CLOUDINARY_API_SECRET", CLOUDINARY_API_SECRET);

  const title = SOCIAL_TITLE || FB_MESSAGE.split("\n")[0] || "";

  // 1080x1350 (use 1080x1080 if you prefer square for FB)
  const jpgBuffer = await renderSocialImage(FB_IMAGE_URL, { width: 1080, height: 1350, title, sub: "READ OUR BLOG POST →" });
  const finalUrl = await signedCloudinaryUploadJpgBuffer(jpgBuffer);

  const pageToken = await getPageToken();
  const postId = await postPhoto({ pageId: PAGE_ID, pageToken, imageUrl: finalUrl, caption: FB_MESSAGE });

  console.log(JSON.stringify({ ok: true, pagePostId: postId, finalUrl }, null, 2));
}

main().catch(err => { console.error(err); process.exit(1); });
