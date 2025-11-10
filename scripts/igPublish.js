// scripts/igPublish.js
import fetch from "node-fetch";
import crypto from "node:crypto";

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

async function probeWithRetry(url, maxRetries = 5) {
  for (let i = 1; i <= maxRetries; i++) {
    const delay = i === 1 ? 0 : 1000 * Math.pow(1.5, i - 2);
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

  console.log(`[CLOUDINARY] Step 1: Uploading with eager transformation...`);

  const folder = "social_overlayed";
  const format = "jpg";
  const timestamp = Math.floor(Date.now() / 1000);

  const H1 = String(title || "").toUpperCase().replace(/\n/g, " ");
  const SUB = String(sub || "").toUpperCase().replace(/\n/g, " ");

  // Instagram: 1080x1080 square with darkened overlay + white text
  const eager =
    `c_fill,w_1080,h_1080,ar_1:1,g_auto,q_auto:good,f_jpg` +
    `/e_brightness:-40` +
    `/co_rgb:FFFFFF,l_text:arial_80_bold:${encodeURIComponent(H1)},g_north,y_400` +
    `/co_rgb:FFFFFF,l_text:arial_32_bold:${encodeURIComponent(SUB)},g_south,y_400`;

  console.log(`[CLOUDINARY] Transform: ${eager.substring(0, 100)}...`);

  const toSign =
    `async=false` +
    `&eager=${eager}` +
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
    async: "false",
    signature,
  });

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });

  const json = await res.json();
  
  if (!res.ok) {
    console.error(`[CLOUDINARY] ❌ Upload failed: ${JSON.stringify(json, null, 2)}`);
    throw new Error(`Cloudinary upload failed: ${res.status} ${JSON.stringify(json)}`);
  }
  
  if (!Array.isArray(json.eager) || !json.eager[0]) {
    console.error(`[CLOUDINARY] ❌ No eager data: ${JSON.stringify(json, null, 2)}`);
    throw new Error(`Cloudinary eager transform failed: ${JSON.stringify(json)}`);
  }

  const eagerData = json.eager[0];
  const eagerUrl = eagerData.secure_url || eagerData.url;
  
  console.log(`[CLOUDINARY] ✅ Eager transformation complete: ${eagerUrl.substring(0, 100)}...`);
  console.log(`[CLOUDINARY] Eager dimensions: ${eagerData.width}x${eagerData.height}`);

  // Step 2: Download the eager-transformed image and re-upload as static asset
  console.log(`[CLOUDINARY] Step 2: Downloading transformed image...`);
  const imageRes = await fetch(eagerUrl);
  if (!imageRes.ok) {
    throw new Error(`Failed to download eager image: ${imageRes.status}`);
  }
  const imageBuffer = await imageRes.buffer();
  console.log(`[CLOUDINARY] Downloaded ${imageBuffer.length} bytes`);

  // Step 3: Re-upload as static asset (no transformations)
  console.log(`[CLOUDINARY] Step 3: Re-uploading as static asset...`);
  const finalFolder = "social_final";
  const finalTimestamp = Math.floor(Date.now() / 1000);
  
  const finalToSign = 
    `folder=${finalFolder}` +
    `&format=${format}` +
    `&timestamp=${finalTimestamp}` +
    `${CLOUDINARY_API_SECRET}`;
  const finalSignature = crypto.createHash("sha1").update(finalToSign).digest("hex");

  const formData = new (await import('form-data')).default();
  formData.append('file', imageBuffer, { filename: 'overlay.jpg' });
  formData.append('api_key', CLOUDINARY_API_KEY);
  formData.append('timestamp', String(finalTimestamp));
  formData.append('folder', finalFolder);
  formData.append('format', format);
  formData.append('signature', finalSignature);

  const finalRes = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: "POST",
    body: formData,
  });

  const finalJson = await finalRes.json();
  
  if (!finalRes.ok) {
    console.error(`[CLOUDINARY] ❌ Re-upload failed: ${JSON.stringify(finalJson, null, 2)}`);
    throw new Error(`Cloudinary re-upload failed: ${finalRes.status} ${JSON.stringify(finalJson)}`);
  }

  const staticUrl = finalJson.secure_url;
  console.log(`[CLOUDINARY] ✅ Static asset created: ${staticUrl}`);
  console.log(`[CLOUDINARY] Final dimensions: ${finalJson.width}x${finalJson.height}`);
  
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
  
  // Instagram needs time to process the media - wait before publishing
  console.log(`[INSTAGRAM] Waiting for Instagram to process the media...`);
  await sleep(15000); // Wait 15 seconds initially
  
  const endpoint = `https://graph.facebook.com/v24.0/${igUserId}/media_publish`;
  const params = new URLSearchParams({
    access_token: pageToken,
    creation_id: creationId,
  });
  
  // Retry logic with exponential backoff
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt++) {
    console.log(`[INSTAGRAM] Publish attempt ${attempt}/5...`);
    
    const r = await fetch(endpoint, { method: "POST", body: params });
    const j = await r.json();
    
    if (r.ok && j.id) {
      console.log(`[INSTAGRAM] ✅ Published: ${j.id}`);
      return j.id;
    }
    
    // Check if it's a "not ready" error
    if (j.error?.error_subcode === 2207027 || j.error?.code === 9007) {
      console.log(`[INSTAGRAM] ⏳ Media not ready yet, waiting...`);
      lastError = j;
      
      if (attempt < 5) {
        const waitTime = 5000 * attempt; // 5s, 10s, 15s, 20s
        console.log(`[INSTAGRAM] Waiting ${waitTime}ms before retry ${attempt + 1}...`);
        await sleep(waitTime);
        continue;
      }
    } else {
      // Different error - fail immediately
      console.error(`[INSTAGRAM] ❌ Publish failed: ${JSON.stringify(j, null, 2)}`);
      throw new Error(`IG media_publish failed: ${r.status} ${JSON.stringify(j)}`);
    }
  }
  
  // All retries exhausted
  console.error(`[INSTAGRAM] ❌ All retries exhausted. Last error: ${JSON.stringify(lastError, null, 2)}`);
  throw new Error(`IG media_publish failed after 5 attempts: ${JSON.stringify(lastError)}`);
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

  // Build final media URL
  let finalMediaUrl;
  if (IS_VIDEO) {
    finalMediaUrl = MEDIA_URL;
    console.log(`[VIDEO] Using original URL: ${finalMediaUrl}`);
  } else {
    const title = SOCIAL_TITLE || POST_TITLE || (caption || "").split("\n")[0] || "";
    const sub = "Swipe for a sneak peek";

    // Upload to Cloudinary with eager transformation, then re-upload as static asset
    const staticUrl = await uploadToCloudinaryWithEager(MEDIA_URL, { title, sub });

    // Probe with retry to ensure the image is accessible
    console.log(`\n[VALIDATION] Probing static URL...`);
    const ok = await probeWithRetry(staticUrl, 5);
    
    if (!ok) {
      throw new Error(`Static URL failed validation: ${staticUrl}`);
    }
    
    finalMediaUrl = staticUrl;
    console.log(`[FINAL] ✅ Using static Cloudinary URL`);
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

  const mediaId = await publishMedia({ igUserId, pageToken, creationId });

  console.log(`\n========== ✅ SUCCESS ==========`);
  console.log(JSON.stringify({ ok: true, igMediaId: mediaId, finalUrl: finalMediaUrl }, null, 2));
}

main().catch((err) => {
  console.error(`\n========== ❌ FATAL ERROR ==========`);
  console.error(err);
  process.exit(1);
});