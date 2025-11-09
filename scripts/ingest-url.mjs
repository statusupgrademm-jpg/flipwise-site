// scripts/ingest-url.mjs
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

const OPENAI_API_KEY      = process.env.OPENAI_API_KEY;
const MODEL               = process.env.OPENAI_MODEL || 'gpt-4.1';
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || '';
const SITE_BASE_URL       = process.env.SITE_BASE_URL || 'https://your-site.com';
const CURATED_FALLBACKS   = (process.env.CURATED_FALLBACKS || '')
  .split(',').map(s => s.trim()).filter(Boolean); // optional, comma-separated Cloudinary URLs

cloudinary.v2.config({ secure: true });

const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,80);

// -------------------- content extract + rewrite --------------------
async function extract(url) {
  const html = await fetch(url).then(r => r.text());
  const dom = new JSDOM(html);
  const reader = new Readability(dom.window.document);
  const article = reader.parse() || {};
  return { html, title: article.title || 'Untitled', content: article.textContent || '' };
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

// -------------------- SMART IMAGE PIPELINE --------------------
const MIN_W = 1600, MIN_H = 900;
function norm(s=''){ return s.toLowerCase(); }

function pickOgImage(doc) {
  const meta = (name) => doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.content;
  return meta('og:image') || meta('twitter:image') || '';
}

function takeLargestImg(doc) {
  const imgs = [...doc.querySelectorAll('img')].map(img => ({
    src: img.src || img.getAttribute('data-src') || '',
    w: parseInt(img.getAttribute('width') || '0', 10) || 0,
    h: parseInt(img.getAttribute('height') || '0', 10) || 0,
    alt: img.getAttribute('alt') || ''
  })).filter(i => i.src && /^https?:\/\//i.test(i.src));
  imgs.sort((a,b) => (b.w*b.h) - (a.w*a.h));
  return imgs[0];
}

async function uploadToCloudinaryByUrl(srcUrl, publicIdBase) {
  const public_id = `flipwise/blog/${publicIdBase}-${Date.now()}`;
  const up = await cloudinary.v2.uploader.upload(srcUrl, {
    public_id,
    overwrite: true,
    invalidate: true,
    resource_type: 'image',
    // enforce 16:9 & quality
    transformation: [
      { fetch_format: 'auto', quality: 'auto' },
      { aspect_ratio: "16:9", crop: "fill", gravity: "auto" }
    ],
  });
  return up.secure_url;
}

async function fetchUnsplashCandidates(queries=[]) {
  if (!UNSPLASH_ACCESS_KEY) return []; // allow running without Unsplash
  const seen = new Set();
  const out = [];
  for (const q of queries.filter(Boolean)) {
    const u = new URL('https://api.unsplash.com/search/photos');
    u.searchParams.set('query', q);
    u.searchParams.set('orientation', 'landscape');
    u.searchParams.set('per_page', '10');
    u.searchParams.set('content_filter', 'high');
    const res = await fetch(u, { headers: { Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}` } });
    if (!res.ok) continue;
    const data = await res.json();
    for (const r of (data.results || [])) {
      if (!r?.urls?.raw) continue;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push({
        id: r.id,
        raw: r.urls.raw,
        w: r.width || 0,
        h: r.height || 0,
        desc: `${r.alt_description || ''} ${r.description || ''} ${(r.tags || []).map(t => t.title).join(' ')}`
      });
    }
  }
  return out;
}

function scoreImage(img, keywords) {
  const hay = norm(img.desc || '');
  const keys = (keywords || []).map(norm);
  let s = 0;
  for (const k of keys) if (k && hay.includes(k)) s += 2;
  if (img.w >= MIN_W && img.h >= MIN_H) s += 2; // size bonus
  return s;
}

async function extractVisualKeywords(openai, title, body) {
  const sys = `Extract 6-10 concrete visual keywords/phrases for a photo that matches this real-estate renovation/investing article.
Return ONLY a JSON array of short strings.`;
  const user = `Title: ${title}\n\nBody (truncated): ${body.slice(0, 4000)}`;
  const r = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4.1',
    temperature: 0.2,
    messages: [{ role:'system', content: sys }, { role:'user', content: user }]
  });
  try { return JSON.parse(r.choices[0].message.content); } catch { return []; }
}

async function chooseImageUrl({ html, title, body, slug, openai }) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // 1) Prefer publisher OG/Twitter image
  const og = pickOgImage(doc);
  if (og) {
    try { return await uploadToCloudinaryByUrl(og, slug); } catch {}
  }

  // 2) Largest in-article image
  const largest = takeLargestImg(doc);
  if (largest?.src) {
    try { return await uploadToCloudinaryByUrl(largest.src, slug); } catch {}
  }

  // 3) Unsplash with smart queries
  const keywords = await extractVisualKeywords(openai, title, body);
  const queries = [title, ...keywords, 'home renovation', 'contractor on site', 'kitchen remodel', 'house exterior']
    .filter(Boolean)
    .slice(0, 12);
  const unsplash = await fetchUnsplashCandidates(queries);
  const filtered = unsplash.filter(i => i.w >= MIN_W && i.h >= MIN_H);
  filtered.sort((a,b) => scoreImage(b, keywords) - scoreImage(a, keywords));
  const pick = filtered[0] || unsplash[0];
  if (pick) {
    try { return await uploadToCloudinaryByUrl(pick.raw, slug); } catch {}
  }

  // 4) Curated brand fallbacks (no black SVG anymore)
  if (CURATED_FALLBACKS.length) {
    const idx = Math.floor(Math.random() * CURATED_FALLBACKS.length);
    try { return await uploadToCloudinaryByUrl(CURATED_FALLBACKS[idx], slug); } catch {}
  }

  throw new Error('No suitable image found'); // fail fast instead of black card
}

// -------------------- main --------------------
(async () => {
  const raw = await extract(SOURCE_URL);
  const rewritten = await rewrite({ title: raw.title, body: raw.content });
  const slug = slugify(rewritten.title);

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
  const image = await chooseImageUrl({
    html: raw.html,
    title: rewritten.title,
    body: rewritten.excerpt + '\n' + (raw.content || ''),
    slug,
    openai
  });

  // keep original createdAt if post already exists
  const nowIso = new Date().toISOString();
  let createdAt = nowIso;
  const postPath = `public/content/posts/${slug}.json`;
  if (existsSync(postPath)) {
    try {
      const prev = JSON.parse(readFileSync(postPath, 'utf8'));
      createdAt = prev.createdAt || prev.date || createdAt;
    } catch {}
  }

  await writePost({
    slug,
    title: rewritten.title,
    createdAt,
    updatedAt: nowIso,
    excerpt: rewritten.excerpt,
    image,
    content: rewritten.content
  });

  const postUrl = `${SITE_BASE_URL.replace(/\/$/, '')}/blog/${slug}`;

  // Emit outputs for GitHub Actions
  const outFile = process.env.GITHUB_OUTPUT;
  if (outFile) {
    await writeFile(
      outFile,
      `cloudinary_url=${image}\n` +
      `title=${rewritten.title}\n` +
      `excerpt=${rewritten.excerpt}\n` +
      `url=${postUrl}\n`,
      { flag: 'a' }
    );
  }

  await writeFile(`public/content/posts/${slug}.source.txt`, SOURCE_URL, 'utf8');
  console.log(`Ingested → ${slug}`);
})();
