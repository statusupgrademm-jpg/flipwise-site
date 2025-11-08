// scripts/instagram.mjs
import fetch from 'node-fetch';

const PAGE_ID = process.env.PAGE_ID;               // FB Page ID
const IG_USER_ID = process.env.IG_USER_ID;         // IG Business account ID (numeric)
const USER_LONG_TOKEN = process.env.FB_LONG_USER_TOKEN; // long-lived USER token

function requireEnv(name, val) {
  if (!val) throw new Error(`Missing required env: ${name}`);
}

async function getPageToken() {
  const r = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${USER_LONG_TOKEN}`);
  const j = await r.json();
  if (!j.data) throw new Error(`Failed to list pages: ${JSON.stringify(j)}`);
  const page = j.data.find(p => p.id === PAGE_ID);
  if (!page?.access_token) throw new Error(`PAGE_TOKEN not found for PAGE_ID=${PAGE_ID}`);
  return page.access_token; // Page token required for IG endpoints
}

async function waitUntilFinished({ creationId, pageToken, timeoutMs = 180000, pollMs = 3000 }) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await fetch(`https://graph.facebook.com/v21.0/${creationId}?fields=status_code&access_token=${pageToken}`);
    const j = await r.json();
    const s = j.status_code;
    if (s === 'FINISHED' || !s) return true; // images often return no status_code
    if (s === 'ERROR') throw new Error(`IG processing error for ${creationId}`);
    await new Promise(res => setTimeout(res, pollMs));
  }
  throw new Error('Timeout waiting for IG processing.');
}

export async function publishToInstagram({ imageUrl, caption, isVideo = false, videoUrl }) {
  requireEnv('PAGE_ID', PAGE_ID);
  requireEnv('IG_USER_ID', IG_USER_ID);
  requireEnv('FB_LONG_USER_TOKEN', USER_LONG_TOKEN);

  if (!imageUrl && !videoUrl) throw new Error('Provide imageUrl or videoUrl');
  if (isVideo && !videoUrl) throw new Error('isVideo=true requires videoUrl');

  const pageToken = await getPageToken();

  // 1) Create media container
  const base = `https://graph.facebook.com/v21.0/${IG_USER_ID}/media`;
  const params = new URLSearchParams({ access_token: pageToken, caption: caption || '' });

  if (isVideo) {
    params.set('media_type', 'REELS');
    params.set('video_url', videoUrl);
  } else {
    params.set('image_url', imageUrl);
  }

  const createRes = await fetch(base, { method: 'POST', body: params });
  const createJson = await createRes.json();
  if (!createJson.id) throw new Error(`IG media create failed: ${createRes.status} ${JSON.stringify(createJson)}`);

  // 2) (Optional) wait for processing (needed for video; safe for images)
  await waitUntilFinished({ creationId: createJson.id, pageToken });

  // 3) Publish media
  const pubRes = await fetch(`https://graph.facebook.com/v21.0/${IG_USER_ID}/media_publish`, {
    method: 'POST',
    body: new URLSearchParams({ creation_id: createJson.id, access_token: pageToken })
  });
  const pubJson = await pubRes.json();
  if (!pubJson.id) throw new Error(`IG media publish failed: ${pubRes.status} ${JSON.stringify(pubJson)}`);

  return { creationId: createJson.id, mediaId: pubJson.id };
}
