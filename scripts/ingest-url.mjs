import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import OpenAI from 'openai';
import cloudinary from 'cloudinary';
import { writeFile } from 'node:fs/promises';
import { writePost } from './new-post.mjs';
import { existsSync, readFileSync } from 'node:fs';

const SOURCE_URL = process.argv[2];
if (!SOURCE_URL) { console.error('Usage: node scripts/ingest-url.mjs <url>'); process.exit(1); }

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || '';

cloudinary.v2.config({ secure: true });

const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,80);

async function extract(url) {
  const html = await fetch(url).then(r => r.text());
  const dom = new JSDOM(html);
  const reader = new Readability(dom.window.document);
  const article = reader.parse() || {};
  return { title: article.title || 'Untitled', content: article.textContent || '' };
}

async function rewrite({ title, body }) {
  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const sys = `Rewrite for a fix-and-flip audience. Output ONLY valid JSON:
{ "title": string, "excerpt": string, "content": [ { "type":"subheader"|"paragraph"|"list", "text"?:string, "items"?:string[] } ] }`;
  const user = `Source title: ${title}\n\nSource body:\n${body}`;
  const resp = await openai.chat.completions.create({
    model: MODEL,
    messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
    temperature: 0.4
  });
  return JSON.parse(resp.choices[0].message.content);
}

// --- Unsplash → Cloudinary (with SVG fallback) ---
async function fetchUnsplashImageUrl(query) {
  if (!UNSPLASH_ACCESS_KEY) throw new Error('UNSPLASH_ACCESS_KEY missing');
  const u = new URL('https://api.unsplash.com/search/photos');
  u.searchParams.set('query', query);
  u.searchParams.set('orientation', 'landscape');
  u.searchParams.set('per_page', '1');
  const res = await fetch(u, { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` } });
  if (!res.ok) throw new Error(`Unsplash HTTP ${res.status}`);
  const data = await res.json();
  const hit = data.results?.[0];
  if (!hit?.urls?.raw) throw new Error('Unsplash: no results');
  return hit.urls.raw; // raw is best for Cloudinary upload+transform
}

async function uploadToCloudinaryByUrl(srcUrl, publicIdBase) {
  const public_id = `flipwise/blog/${publicIdBase}-${Date.now()}`;
  const up = await cloudinary.v2.uploader.upload(srcUrl, {
    public_id,
    overwrite: true,
    invalidate: true,
    resource_type: 'image',
    transformation: [{ fetch_format: 'auto', quality: 'auto' }],
  });
  return up.secure_url;
}

async function genFallbackSvgToCloudinary(label, publicIdBase) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">
  <rect width="100%" height="100%" fill="#111"/>
  <text x="50%" y="50%" fill="#fff" font-size="54" text-anchor="middle" font-family="Arial">
    ${(label || 'Blog').slice(0, 64)}
  </text></svg>`;
  const tmp = `/tmp/banner-${Date.now()}.svg`;
  await writeFile(tmp, svg, 'utf8');
  const public_id = `flipwise/blog/${publicIdBase}-${Date.now()}`;
  const up = await cloudinary.v2.uploader.upload(tmp, {
    public_id,
    overwrite: true,
    invalidate: true,
    resource_type: 'image',
    format: 'png',
  });
  return up.secure_url;
}

async function getImageUrlForPost(slug, title) {
  try {
    const q = title || 'real estate renovation';
    const unsplashRaw = await fetchUnsplashImageUrl(q);
    return await uploadToCloudinaryByUrl(unsplashRaw, slug);
  } catch (e) {
    console.error('[image] Unsplash failed, using SVG fallback:', e.message);
    return await genFallbackSvgToCloudinary(title, slug);
  }
}

(async () => {
  const raw = await extract(SOURCE_URL);
  const rewritten = await rewrite({ title: raw.title, body: raw.content });
  const slug = slugify(rewritten.title);
  const image = await getImageUrlForPost(slug, rewritten.title);
  // const date = new Date().toISOString().slice(0,10);
  
  // --- NEW DATE LOGIC STARTS HERE ---
  const nowIso = new Date().toISOString();
  let createdAt = nowIso;
  const postPath = `public/content/posts/${slug}.json`;

  if (existsSync(postPath)) {
    try {
      const prev = JSON.parse(readFileSync(postPath, 'utf8'));
      createdAt = prev.createdAt || prev.date || createdAt;
    } catch {}
  }
  // --- NEW DATE LOGIC ENDS HERE ---


  

  await writePost({
    slug,
    title: rewritten.title,
    createdAt,
    updatedAt: nowIso,
    // date,
    excerpt: rewritten.excerpt,
    image,
    content: rewritten.content
  });

  await writeFile(`public/content/posts/${slug}.source.txt`, SOURCE_URL, 'utf8');
  console.log(`Ingested → ${slug}`);
})();
