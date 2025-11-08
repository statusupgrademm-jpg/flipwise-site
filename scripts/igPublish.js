// scripts/igPublish.js
import fetch from "node-fetch";

const PAGE_ID = process.env.PAGE_ID;
const IG_USER_ID = process.env.IG_USER_ID;
const USER_LONG_TOKEN = process.env.FB_LONG_USER_TOKEN; // long-lived USER token

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing required env: ${name}`);
}

async function getPageToken() {
  const r = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${USER_LONG_TOKEN}`);
  const j = await r.json();
  if (!j.data) throw new Error(`Failed to list pages: ${JSON.stringify(j)}`);
  const page = j.data.find(p => p.id === PAGE_ID);
  if (!page?.access_token) throw new Error(`PAGE_TOKEN not found for PAGE_ID=${PAGE_ID}`);
  return page.access_token; // PAGE_TOKEN
}

function buildCaption({ title, excerpt, url, tags = [] }) {
  const tagLine = tags.length ? "\n\n" + tags.map(t => (t.startsWith("#") ? t : `#${t}`)).join(" ") : "";
  return `${title}\n\n${excerpt}\n\n${url}${tagLine}`.slice(0, 2200);
}

async function createContainer({ igUserId, pageToken, mediaUrl, caption, isVideo }) {
  const base = `https://graph.facebook.com/v21.0/${igUserId}/media`;
  const params = new URLSearchParams({
    access_token: pageToken,
    caption, // DO NOT pre-encode; URLSearchParams handles it
  });
  if (isVideo) {
    params.set("media_type", "REELS");
    params.set("video_url", mediaUrl);
  } else {
    params.set("image_url", mediaUrl);
  }
  const r = await fetch(base, { method: "POST", body: params });
  const j = await r.json();
  if (!j.id) throw new Error(`Create container failed: ${JSON.stringify(j)}`);
  return j.id;
}

async function publishContainer({ igUserId, creationId, pageToken }) {
  const r = await fetch(`https://graph.facebook.com/v21.0/${igUserId}/media_publish`, {
    method: "POST",
    body: new URLSearchParams({ creation_id: creationId, access_token: pageToken }),
  });
  const j = await r.json();
  if (!j.id) throw new Error(`Publish failed: ${JSON.stringify(j)}`);
  return j.id; // media id
}

async function waitUntilFinished({ creationId, pageToken, timeoutMs = 180000, pollMs = 3000 }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await fetch(`https://graph.facebook.com/v21.0/${creationId}?fields=status_code&access_token=${pageToken}`);
    const j = await r.json();
    const s = j.status_code;
    if (s === "FINISHED") return true;
    if (s === "ERROR") throw new Error(`IG processing error for ${creationId}`);
    await new Promise(res => setTimeout(res, pollMs));
  }
  throw new Error("Timeout waiting for IG processing.");
}

async function main() {
  requireEnv("PAGE_ID", PAGE_ID);
  requireEnv("IG_USER_ID", IG_USER_ID);
  requireEnv("FB_LONG_USER_TOKEN", USER_LONG_TOKEN);

  const mediaUrl = process.env.MEDIA_URL;           // Cloudinary URL
  const title    = process.env.POST_TITLE || "";
  const excerpt  = process.env.POST_EXCERPT || "";
  const url      = process.env.POST_URL || "";      // your site post URL
  const tags     = (process.env.POST_TAGS || "").split(",").map(s => s.trim()).filter(Boolean);
  const isVideo  = (process.env.IS_VIDEO || "false").toLowerCase() === "true";

  if (!mediaUrl) throw new Error("MEDIA_URL missing");

  // Helpful debug while testing
  console.log("PAGE_ID", PAGE_ID, "IG_USER_ID", IG_USER_ID);
  console.log("MEDIA_URL", mediaUrl);
  console.log("Caption preview:", buildCaption({ title, excerpt, url, tags }).slice(0, 120));

  const pageToken = await getPageToken();
  const caption = buildCaption({ title, excerpt, url, tags });

  const creationId = await createContainer({
    igUserId: IG_USER_ID,
    pageToken,
    mediaUrl,
    caption, // not pre-encoded
    isVideo,
  });

  await waitUntilFinished({ creationId, pageToken });
  const mediaId = await publishContainer({ igUserId: IG_USER_ID, creationId, pageToken });

  console.log(JSON.stringify({ ok: true, mediaId }, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
