// scripts/fbPublish.js
import fetch from "node-fetch";
import crypto from "node:crypto";

/**
 * Publishes to a Facebook Page. Uses a PAGE_TOKEN derived from a long-lived USER token.
 * If an image is provided, uses /photos with eager Cloudinary upload; otherwise /feed (text/link).
 */

const PAGE_ID = process.env.PAGE_ID;
const USER_LONG_TOKEN = process.env.FB_LONG_USER_TOKEN;
const MESSAGE = process.env.FB_MESSAGE || "";
const IMAGE_URL = process.env.FB_IMAGE_URL || "";
const LINK_URL = process.env.FB_LINK_URL || "";
const SOCIAL_TITLE = process.env.SOCIAL_TITLE || "";

// Cloudinary creds
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || "";
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY || "";
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || "";

function requireEnv(name, val) {
  if (!val) throw new Error(`Missing env: ${name}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probeImage(url, attemptNum = 1) {
  console.log(`[FB-PROBE #${attemptNum}] Testing: ${url}`);
  try {
    const r = await fetch(url, { method: "HEAD", timeout: 10000 });
    console.log(`[FB-PROBE #${attemptNum}] Status: ${r.status}`);
    
    if (!r.ok) {
      console.error(`[FB-PROBE #${attemptNum}] ❌ Failed: HTTP ${r.status}`);
      return false;
    }
    
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    const len = parseInt(r.headers.get("content-length") || "0", 10);
    
    console.log(`[FB-PROBE #${attemptNum}] Content-Type: ${ct}`);
    console.log(`[FB-PROBE #${attemptNum}] Content-Length: ${len} bytes`);
    
    const isValid = ct.includes("image/") && len > 10000;
    console.log(`[FB-PROBE #${attemptNum}] ${isValid ? '✅ Valid' : '❌ Invalid'}`);
    
    return isValid;
  } catch (err) {
    console.error(`[FB-PROBE #${attemptNum}] ❌ Exception: ${err.message}`);
    return false;
  }
}

async function probeWithRetry(url, maxRetries = 5) {
  for (let i = 1; i <= maxRetries; i++) {
    const delay = i === 1 ? 0 : 1000 * Math.pow(1.5, i - 2);
    if (delay > 0) {
      console.log(`[FB-RETRY] Waiting ${delay}ms before attempt ${i}...`);
      await sleep(delay);
    }
    
    const ok = await probeImage(url, i);
    if (ok) {
      console.log(`[FB-RETRY] ✅ Success on attempt ${i}/${maxRetries}`);
      return true;
    }
  }
  
  console.error(`[FB-RETRY] ❌ All ${maxRetries} attempts failed`);
  return false;
}

async function uploadToCloudinaryWithEager(baseImageUrl, { title, sub }) {
  requireEnv("CLOUDINARY_CLOUD_NAME", CLOUDINARY_CLOUD_NAME);
  requireEnv("CLOUDINARY_API_KEY", CLOUDINARY_API_KEY);
  requireEnv("CLOUDINARY_API_SECRET", CLOUDINARY_API_SECRET);

  console.log(`[FB-CLOUDINARY] Uploading original: ${baseImageUrl}`);

  const folder = "social_overlayed";
  const format = "jpg";
  const timestamp = Math.floor(Date.now() / 1000);

  const H1 = String(title || "").toUpperCase().replace(/\n/g, " ");
  const SUB = String(sub || "").toUpperCase().replace(/\n/g, " ");

  // Facebook: 1200x630 landscape with darkened overlay + white text
  const eager =
    `c_fill,w_1200,h_630,ar_191:100,g_auto,q_auto:good,f_jpg` +
    `/e_brightness:-40` +
    `/co_rgb:FFFFFF,l_text:arial_60_bold:${encodeURIComponent(H1)},g_north,y_200` +
    `/co_rgb:FFFFFF,l_text:arial_28_bold:${encodeURIComponent(SUB)},g_south,y_200`;

  console.log(`[FB-CLOUDINARY] Transform: ${eager.substring(0, 100)}...`);

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
  
  console.log(`[FB-CLOUDINARY] Response status: ${res.status}`);
  console.log(`[FB-CLOUDINARY] Full response:`, JSON.stringify(json, null, 2));
  
  if (!res.ok) {
    console.error(`[FB-CLOUDINARY] ❌ Upload failed: ${JSON.stringify(json, null, 2)}`);
    throw new Error(`Cloudinary upload failed: ${res.status} ${JSON.stringify(json)}`);
  }
  
  if (!Array.isArray(json.eager) || !json.eager[0]) {
    console.error(`[FB-CLOUDINARY] ❌ No eager data: ${JSON.stringify(json, null, 2)}`);
    throw new Error(`Cloudinary eager transform failed: ${JSON.stringify(json)}`);
  }

  const eagerData = json.eager[0];
  console.log(`[FB-CLOUDINARY] Eager data:`, JSON.stringify(eagerData, null, 2));
  
  // Build clean static URL - use eager's secure_url
  let staticUrl;
  
  if (eagerData.secure_url) {
    staticUrl = eagerData.secure_url;
    console.log(`[FB-CLOUDINARY] ✅ Using eager secure_url: ${staticUrl}`);
  } else if (json.public_id) {
    // Fallback: construct from public_id
    staticUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/${json.public_id}.jpg`;
    console.log(`[FB-CLOUDINARY] ⚠️ Constructed from public_id: ${staticUrl}`);
  } else {
    throw new Error(`Cannot extract static URL from Cloudinary response: ${JSON.stringify(json)}`);
  }
  
  // Verify it's truly static (no transform markers in URL)
  if (staticUrl.includes('/c_fill,') || staticUrl.includes('/e_brightness')) {
    console.error(`[FB-CLOUDINARY] ❌ URL still contains transforms! ${staticUrl}`);
    throw new Error(`Eager URL contains transforms - not a static asset URL`);
  }
  
  console.log(`[FB-CLOUDINARY] Dimensions: ${eagerData.width}x${eagerData.height}`);
  
  return staticUrl;
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

async function postPhoto({ pageId, pageToken, imageUrl, caption }) {
  console.log(`[FACEBOOK] Posting photo: ${imageUrl}`);
  console.log(`[FACEBOOK] Caption length: ${caption?.length || 0} chars`);
  
  const form = new URLSearchParams({
    access_token: pageToken,
    url: imageUrl,
    caption: caption || "",
  });
  const r = await fetch(`https://graph.facebook.com/v24.0/${pageId}/photos`, {
    method: "POST",
    body: form,
  });
  const j = await r.json();
  if (!r.ok || !j.id) {
    console.error(`[FACEBOOK] ❌ /photos failed: ${JSON.stringify(j, null, 2)}`);
    throw new Error(`FB /photos failed: ${r.status} ${JSON.stringify(j)}`);
  }
  console.log(`[FACEBOOK] ✅ Photo posted: ${j.id}`);
  return j.id;
}

async function postFeed({ pageId, pageToken, message, link }) {
  console.log(`[FACEBOOK] Posting feed update`);
  const form = new URLSearchParams({
    access_token: pageToken,
    message: message || "",
  });
  if (link) form.set("link", link);
  const r = await fetch(`https://graph.facebook.com/v24.0/${pageId}/feed`, {
    method: "POST",
    body: form,
  });
  const j = await r.json();
  if (!r.ok || !j.id) {
    console.error(`[FACEBOOK] ❌ /feed failed: ${JSON.stringify(j, null, 2)}`);
    throw new Error(`FB /feed failed: ${r.status} ${JSON.stringify(j)}`);
  }
  console.log(`[FACEBOOK] ✅ Feed posted: ${j.id}`);
  return j.id;
}

async function main() {
  requireEnv("PAGE_ID", PAGE_ID);
  requireEnv("FB_LONG_USER_TOKEN", USER_LONG_TOKEN);

  console.log(`\n========== FACEBOOK PUBLISH START ==========`);
  console.log(`Original IMAGE_URL: ${IMAGE_URL || 'none'}`);

  const caption = MESSAGE;
  const link = LINK_URL;

  let finalImageUrl = "";

  if (IMAGE_URL) {
    // Validate original
    console.log(`\n[VALIDATION] Checking original IMAGE_URL...`);
    const originalValid = await probeImage(IMAGE_URL, 0);
    if (!originalValid) {
      console.warn(`[VALIDATION] ⚠️ Original IMAGE_URL failed probe - continuing anyway`);
    }

    // Build overlayed image via eager upload
    const title = SOCIAL_TITLE || (caption || "").split("\n")[0] || "";
    const eagerUrl = await uploadToCloudinaryWithEager(IMAGE_URL, {
      title,
      sub: "Swipe for a sneak peek",
    });

    // Probe with retry
    console.log(`\n[VALIDATION] Probing eager URL...`);
    const ok = await probeWithRetry(eagerUrl, 5);
    
    if (ok) {
      finalImageUrl = eagerUrl;
      console.log(`[FINAL] ✅ Using Cloudinary eager URL`);
    } else {
      console.warn(`[FINAL] ⚠️ Eager URL probe failed, using original`);
      if (!originalValid) {
        throw new Error(`Both eager URL and original IMAGE_URL failed validation`);
      }
      finalImageUrl = IMAGE_URL;
    }

    // Final check
    console.log(`\n[PRE-PUBLISH] Final validation...`);
    const finalCheck = await probeImage(finalImageUrl, 99);
    if (!finalCheck) {
      throw new Error(`Final image URL failed validation: ${finalImageUrl}`);
    }
    console.log(`[PRE-PUBLISH] ✅ Validated`);
  }

  console.log(`\n[FACEBOOK] Authenticating...`);
  const pageToken = await getPageToken();

  let postId;
  if (finalImageUrl) {
    postId = await postPhoto({ pageId: PAGE_ID, pageToken, imageUrl: finalImageUrl, caption });
  } else {
    postId = await postFeed({ pageId: PAGE_ID, pageToken, message: caption, link });
  }

  console.log(`\n========== ✅ SUCCESS ==========`);
  console.log(JSON.stringify({ ok: true, pagePostId: postId, finalUrl: finalImageUrl }, null, 2));
}

main().catch((err) => {
  console.error(`\n========== ❌ FATAL ERROR ==========`);
  console.error(err);
  process.exit(1);
});