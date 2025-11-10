// scripts/igPublish.js
import fetch from "node-fetch";
import crypto from "node:crypto";

/**
 * Instagram publishing via Page token (no IG_ACCESS_TOKEN required).
 * Uses a signed Cloudinary eager upload to generate a static JPG with overlay before posting to IG.
 * Adds fetch-probe + retry to avoid IG aspect/availability errors.
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

/* ---------- utils ---------- */

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 🔧 FIX #2: Enhanced probe with detailed logging
async function probeImage(url, attemptNum = 1) {
  console.log(`[PROBE #${attemptNum}] Testing: ${url}`);
  try {
    const r = await fetch(url, { method: "HEAD", timeout: 10000 });
    console.log(`[PROBE #${attemptNum}] Status: ${r.status}`);
    
    if (!r.ok) {
      console.error(`[PROBE #${attemptNum}] ❌ Failed: HTTP ${r.status}`);
      return false;
    }
    
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    const len = parseInt(r.headers.get("content-length") || "0", 10);
    
    console.log(`[PROBE #${attemptNum}] Content-Type: ${ct}`);
    console.log(`[PROBE #${attemptNum}] Content-Length: ${len} bytes`);
    
    const isValid = ct.includes("image/") && len > 10000;
    console.log(`[PROBE #${attemptNum}] ${isValid ? '✅ Valid' : '❌ Invalid'} (needs image/* type & >10KB)`);
    
    return isValid;
  } catch (err) {
    console.error(`[PROBE #${attemptNum}] ❌ Exception: ${err.message}`);
    return false;
  }
}

// 🔧 FIX #2: Better retry with exponential backoff
async function probeWithRetry(url, maxRetries = 5) {
  for (let i = 1; i <= maxRetries; i++) {
    const delay = i === 1 ? 0 : 1000 * Math.pow(1.5, i - 2); // 0, 1s, 1.5s, 2.25s, 3.38s
    if (delay > 0) {
      console.log(`[RETRY] Waiting ${delay}ms before attempt ${i}...`);
      await sleep(delay);
    }
    
    const ok = await probeImage(url, i);
    if (ok) {
      console.log(`[RETRY] ✅ Success on attempt ${i}/${maxRetries}`);
      return true;
    }
  }
  
  console.error(`[RETRY] ❌ All ${maxRetries} attempts failed`);
  return false;
}

async function uploadToCloudinaryWithEager(baseImageUrl, { title, sub }) {
  requireEnv("CLOUDINARY_CLOUD_NAME", CLOUDINARY_CLOUD_NAME);
  requireEnv("CLOUDINARY_API_KEY", CLOUDINARY_API_KEY);
  requireEnv("CLOUDINARY_API_SECRET", CLOUDINARY_API_SECRET);

  console.log(`[CLOUDINARY] Uploading original: ${baseImageUrl}`);

  const folder = "social_overlayed";
  const format = "jpg";
  const timestamp = Math.floor(Date.now() / 1000);

  const H1 = String(title || "").toUpperCase().replace(/\n/g, " ");
  const SUB = String(sub || "").toUpperCase().replace(/\n/g, " ");

  // Force exact 1:1 square 1080x1080; strip metadata; final JPG
  const eager =
    `ar_1:1,c_fill,w_1080,h_1080,g_auto,fl_strip_profile,q_auto,f_jpg` +
    `/e_colorize:70,co_rgb:000000` +
    `/l_text:Montserrat_90_bold:${encodeURIComponent(H1)},co_rgb:ffffff,g_center,y_-60` +
    `/l_text:Montserrat_32_bold:${encodeURIComponent(SUB)},co_rgb:ffffff,g_center,y_360`;

  console.log(`[CLOUDINARY] Transform: ${eager.substring(0, 100)}...`);

  // SIGNATURE
  const toSign =
    `eager=${eager}` +
    `&folder=${folder}` +
    `&format=${format}` +
    `&timestamp=${timestamp}` +
    `${CLOUDINARY_API_SECRET}`;
  const signature = crypto.createHash("sha1").update(toSign).digest("hex");

  const form = new URLSearchParams({
    file: baseImageUrl,
    api_key: CLOUDINARY_API_KEY,
    timestamp: String(timestamp),
    folder,
    eager,
    format,
    signature,
    async: "false", // 🔧 FIX: Force synchronous processing
  });

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });

  const json = await res.json();
  
  console.log(`[CLOUDINARY] Response status: ${res.status}`);
  console.log(`[CLOUDINARY] Full response:`, JSON.stringify(json, null, 2)); // 🔧 DEBUG: See full response
  
  if (!res.ok) {
    console.error(`[CLOUDINARY] ❌ Upload failed: ${JSON.stringify(json, null, 2)}`);
    throw new Error(`Cloudinary upload failed: ${res.status} ${JSON.stringify(json)}`);
  }
  
  if (!Array.isArray(json.eager) || !json.eager[0]) {
    console.error(`[CLOUDINARY] ❌ No eager data in response: ${JSON.stringify(json, null, 2)}`);
    throw new Error(`Cloudinary eager transform failed: ${JSON.stringify(json)}`);
  }

  const eagerData = json.eager[0];
  console.log(`[CLOUDINARY] Eager data:`, JSON.stringify(eagerData, null, 2));
  
  // 🔧 FIX: Extract public_id from eager response and build clean static URL
  // The eager response should have a public_id for the derived asset
  let staticUrl;
  
  if (eagerData.public_id) {
    // Build a clean URL with no transforms using the derived asset's public_id
    staticUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/${eagerData.public_id}.jpg`;
    console.log(`[CLOUDINARY] ✅ Built static URL from public_id: ${staticUrl}`);
  } else if (eagerData.secure_url && !eagerData.secure_url.includes('/upload/ar_')) {
    // If secure_url doesn't contain transforms, use it directly
    staticUrl = eagerData.secure_url;
    console.log(`[CLOUDINARY] ✅ Using secure_url (no transforms): ${staticUrl}`);
  } else {
    // Fallback: Try to extract the base public_id and construct URL
    const basePublicId = json.public_id; // Original upload public_id
    if (basePublicId) {
      // Cloudinary derives eager assets with a different public_id, but if not available,
      // we'll use the original with no transforms
      staticUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/${basePublicId}.jpg`;
      console.warn(`[CLOUDINARY] ⚠️ Using base public_id as fallback: ${staticUrl}`);
    } else {
      throw new Error(`Cannot construct static URL. Eager response: ${JSON.stringify(eagerData)}`);
    }
  }
  
  console.log(`[CLOUDINARY] Width: ${eagerData.width}, Height: ${eagerData.height}`);
  
  return staticUrl;
}

/* ---------- facebook/instagram graph helpers ---------- */

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
  // 🔧 FIX #1: Log the actual URL being sent to Instagram
  console.log(`[INSTAGRAM] Creating container with URL: ${mediaUrl}`);
  console.log(`[INSTAGRAM] Caption length: ${caption?.length || 0} chars`);
  console.log(`[INSTAGRAM] Media type: ${isVideo ? 'VIDEO' : 'IMAGE'}`);
  
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
    console.error(`[INSTAGRAM] ❌ Container creation failed: ${JSON.stringify(j, null, 2)}`);
    throw new Error(`IG create container failed: ${r.status} ${JSON.stringify(j)}`);
  }
  console.log(`[INSTAGRAM] ✅ Container created: ${j.id}`);
  return j.id;
}

async function publishMedia({ igUserId, pageToken, creationId }) {
  console.log(`[INSTAGRAM] Publishing container: ${creationId}`);
  const endpoint = `https://graph.facebook.com/v24.0/${igUserId}/media_publish`;
  const params = new URLSearchParams({
    access_token: pageToken,
    creation_id: creationId,
  });
  const r = await fetch(endpoint, { method: "POST", body: params });
  const j = await r.json();
  if (!r.ok || !j.id) {
    console.error(`[INSTAGRAM] ❌ Publish failed: ${JSON.stringify(j, null, 2)}`);
    throw new Error(`IG media_publish failed: ${r.status} ${JSON.stringify(j)}`);
  }
  console.log(`[INSTAGRAM] ✅ Published: ${j.id}`);
  return j.id;
}

/* ---------- main ---------- */

async function main() {
  requireEnv("PAGE_ID", PAGE_ID);
  requireEnv("FB_LONG_USER_TOKEN", USER_LONG_TOKEN);
  requireEnv("MEDIA_URL", MEDIA_URL);

  console.log(`\n========== INSTAGRAM PUBLISH START ==========`);
  console.log(`Original MEDIA_URL: ${MEDIA_URL}`);
  console.log(`IS_VIDEO: ${IS_VIDEO}`);

  const caption = buildCaption();

  // Build final media URL:
  let finalMediaUrl;
  if (IS_VIDEO) {
    finalMediaUrl = MEDIA_URL;
    console.log(`[VIDEO] Using original URL: ${finalMediaUrl}`);
  } else {
    const title = SOCIAL_TITLE || POST_TITLE || (caption || "").split("\n")[0] || "";
    
    // 🔧 FIX #3: Validate MEDIA_URL before processing
    console.log(`\n[VALIDATION] Checking original MEDIA_URL accessibility...`);
    const originalValid = await probeImage(MEDIA_URL, 0);
    if (!originalValid) {
      console.warn(`[VALIDATION] ⚠️  Original MEDIA_URL failed probe - continuing anyway`);
    }
    
    const eagerUrl = await uploadToCloudinaryWithEager(MEDIA_URL, {
      title,
      sub: "Swipe for a sneak peek",
    });

    // 🔧 FIX #2: Better retry logic with exponential backoff
    console.log(`\n[VALIDATION] Probing eager URL with retry...`);
    const ok = await probeWithRetry(eagerUrl, 5);
    
    if (ok) {
      finalMediaUrl = eagerUrl;
      console.log(`[FINAL] ✅ Using Cloudinary eager URL: ${finalMediaUrl}`);
    } else {
      console.warn(`[FINAL] ⚠️  Eager URL probe failed, falling back to original MEDIA_URL`);
      // 🔧 FIX #3: Verify fallback is valid
      if (!originalValid) {
        throw new Error(`Both eager URL and original MEDIA_URL failed validation. Cannot proceed.`);
      }
      finalMediaUrl = MEDIA_URL;
      console.log(`[FINAL] Using fallback: ${finalMediaUrl}`);
    }
  }

  // 🔧 FIX #1: Final validation before Instagram
  console.log(`\n[PRE-PUBLISH] Final URL validation...`);
  console.log(`[PRE-PUBLISH] URL: ${finalMediaUrl}`);
  if (!IS_VIDEO) {
    const finalCheck = await probeImage(finalMediaUrl, 99);
    if (!finalCheck) {
      throw new Error(`Final media URL failed validation: ${finalMediaUrl}`);
    }
    console.log(`[PRE-PUBLISH] ✅ Final URL validated successfully`);
  }

  console.log(`\n[INSTAGRAM] Authenticating...`);
  const pageToken = await getPageToken();
  const igUserId = await getInstagramUserId({ pageId: PAGE_ID, pageToken });
  console.log(`[INSTAGRAM] IG User ID: ${igUserId}`);

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

  console.log(`\n========== ✅ SUCCESS ==========`);
  console.log(JSON.stringify({ ok: true, igMediaId: mediaId, finalUrl: finalMediaUrl }, null, 2));
}

main().catch((err) => {
  console.error(`\n========== ❌ FATAL ERROR ==========`);
  console.error(err);
  process.exit(1);
});