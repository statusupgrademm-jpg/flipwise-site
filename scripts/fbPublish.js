// scripts/fbPublish.js
import fetch from "node-fetch";

/**
 * Publishes to a Facebook Page. Uses a PAGE_TOKEN derived from a long-lived USER token.
 * If imageUrl is provided, uses /photos. Otherwise /feed (text/link).
 */

const PAGE_ID = process.env.PAGE_ID;
const USER_LONG_TOKEN = process.env.FB_LONG_USER_TOKEN; // long-lived USER token
const MESSAGE = process.env.FB_MESSAGE || "";           // caption
const IMAGE_URL = process.env.FB_IMAGE_URL || "";       // optional image url
const LINK_URL  = process.env.FB_LINK_URL  || "";       // optional link (for /feed posts)

function requireEnv(name, val) {
  if (!val) throw new Error(`Missing env: ${name}`);
}

async function getPageToken() {
  // Exchange long-lived USER token -> PAGE token
  const r = await fetch(`https://graph.facebook.com/v24.0/me/accounts?access_token=${USER_LONG_TOKEN}`);
  const j = await r.json();
  if (!j?.data) throw new Error(`me/accounts failed: ${JSON.stringify(j)}`);
  const page = j.data.find(p => p.id === PAGE_ID);
  if (!page?.access_token) {
    throw new Error(`PAGE_TOKEN not found for PAGE_ID=${PAGE_ID}. me/accounts=${JSON.stringify(j)}`);
  }
  return page.access_token;
}

async function postPhoto({ pageId, pageToken, imageUrl, caption }) {
  const form = new URLSearchParams({
    access_token: pageToken,
    url: imageUrl,
    caption: caption || ""
  });
  const r = await fetch(`https://graph.facebook.com/v24.0/${pageId}/photos`, {
    method: "POST",
    body: form
  });
  const j = await r.json();
  if (!r.ok || !j.id) throw new Error(`FB /photos failed: ${r.status} ${JSON.stringify(j)}`);
  return j.id;
}

async function postFeed({ pageId, pageToken, message, link }) {
  const form = new URLSearchParams({
    access_token: pageToken,
    message: message || ""
  });
  if (link) form.set("link", link);
  const r = await fetch(`https://graph.facebook.com/v24.0/${pageId}/feed`, {
    method: "POST",
    body: form
  });
  const j = await r.json();
  if (!r.ok || !j.id) throw new Error(`FB /feed failed: ${r.status} ${JSON.stringify(j)}`);
  return j.id;
}

async function main() {
  requireEnv("PAGE_ID", PAGE_ID);
  requireEnv("FB_LONG_USER_TOKEN", USER_LONG_TOKEN);

  // inputs (usually from workflow)
  const caption = MESSAGE;
  const imageUrl = IMAGE_URL;
  const link = LINK_URL;

  const pageToken = await getPageToken();

  let postId;
  if (imageUrl) {
    postId = await postPhoto({ pageId: PAGE_ID, pageToken, imageUrl, caption });
  } else {
    postId = await postFeed({ pageId: PAGE_ID, pageToken, message: caption, link });
  }

  console.log(JSON.stringify({ ok: true, pagePostId: postId }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
