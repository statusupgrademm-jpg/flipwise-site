// scripts/ingest-url.mjs
// Generate blog posts + uploads image
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import OpenAI from 'openai';
import cloudinary from 'cloudinary';
import { writeFile } from 'node:fs/promises';
import { writePost } from './new-post.mjs';
import { existsSync, readFileSync } from 'node:fs';

const SOURCE_URL = process.argv[2];
if (!SOURCE_URL) {
  console.error('Usage: node scripts/ingest-url.mjs <url>');
  process.exit(1);
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY || '';
const SITE_BASE_URL = process.env.SITE_BASE_URL || 'https://your-site.com';

// --- basic env guards (clearer failures) ---
function requireEnv(name, val) {
  if (!val) {
    console.error(`${name} is missing`);
    process.exit(1);
  }
}
requireEnv('OPENAI_API_KEY', OPENAI_API_KEY);
requireEnv('CLOUDINARY_URL', process.env.CLOUDINARY_URL);
requireEnv('UNSPLASH_ACCESS_KEY', UNSPLASH_ACCESS_KEY);

// OpenAI client
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Cloudinary: reads CLOUDINARY_URL from env; secure URLs on
cloudinary.v2.config({ secure: true });

const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80);

function buildPostUrl(base, slug) {
  const b = base.replace(/\/$/, '');
  return b.includes('#/blog') || /\/blog$/.test(b)
    ? `${b}/${slug}`
    : `${b}/blog/${slug}`;
}

async function extract(url) {
  const html = await fetch(url).then((r) => r.text());
  const dom = new JSDOM(html);
  const reader = new Readability(dom.window.document);
  const article = reader.parse() || {};
  return { title: article.title || 'Untitled', content: article.textContent || '' };
}

/** ------------------ Org-name sanitizer helpers ------------------ */
// Split text into modifiable parts and "locked" parts (URLs/emails) we won't touch
function splitByUrlsEmails(text) {
  const urlEmailRe = /((?:https?:\/\/|www\.)\S+|[\w.+-]+@[\w.-]+\.\w+)/gi;
  const parts = [];
  let last = 0, m;
  while ((m = urlEmailRe.exec(text)) !== null) {
    if (m.index > last) parts.push({ kind: 'text', value: text.slice(last, m.index) });
    parts.push({ kind: 'locked', value: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) });
  return parts;
}

// Replace organization names only outside quotes; preserve possessives
function replaceOrgsInSegment(segment, orgs, replacement = 'Flipwise Consulting') {
  return segment.replace(/(?:'[^']*'|"[^"]*")|([^'"]+)/g, (match, outside) => {
    if (!outside) return match; // inside quotes -> leave as-is
    let out = outside;
    for (const org of orgs) {
      if (!org || org.length < 2) continue;
      const esc = org.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\b${esc}(?:'s)?\\b`, 'gi');
      out = out.replace(re, (m) => {
        const possessive = /'s$/i.test(m) ? "'s" : '';
        return replacement + possessive;
      });
    }
    return out;
  });
}

function sanitizeOrganizations(text, orgCandidates, replacement = 'Flipwise Consulting') {
  if (!text || !Array.isArray(orgCandidates) || orgCandidates.length === 0) return text;
  const parts = splitByUrlsEmails(text);
  return parts
    .map((p) => (p.kind === 'locked' ? p.value : replaceOrgsInSegment(p.value, orgCandidates, replacement)))
    .join('');
}
/** --------------------------------------------------------------- */

/** --- main: rewrite with org normalization --- */
export async function rewrite({ title, body }) {
  const SYSTEM_PROMPT = `
You rewrite articles for an audience of real estate investors — people interested in using real estate as an investment tool.
Write in a neutral, educational tone that emphasizes practical insights, clarity, and financial takeaways.

TASKS:
1. Rephrase the article title into a concise version not exceeding 6 words. It should be clear, benefit-driven, and suitable for social sharing.
   - Do not include punctuation at the end.
   - Avoid emojis, hashtags, and quotes.
   - Focus on what the reader will learn or gain.

ENTITY NORMALIZATION RULES:
- If the source text mentions a company/brand/organization, normalize it to "Flipwise Consulting",
  except:
  • Proper nouns that are not companies (cities, people, laws).
  • URLs, domains, emails, or code.
  • Direct quotes inside "..." or '...'.
- If a specific third-party name is necessary for context, generalize it as "a third-party firm".

OUTPUT FORMAT:
Return ONLY valid JSON with this exact shape:
{
  "title": string,      // your rephrased ≤6-word title
  "excerpt": string,    // 1-2 sentence summary for preview
  "content": [
    { "type": "subheader" | "paragraph" | "list", "text"?: string, "items"?: string[] }
  ],
  "orgs": string[]      // unique company/brand/organization names detected in the source
}
`.trim();

  const USER_PROMPT = `Source title: ${title}\n\nSource body:\n${body}`;

  const resp = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: USER_PROMPT }
    ],
    temperature: 0.3
  });

  const raw = JSON.parse(resp.choices[0].message.content || '{}');

  // Fallbacks
  raw.title = String(raw.title || '').trim();
  raw.excerpt = String(raw.excerpt || '').trim();
  raw.content = Array.isArray(raw.content) ? raw.content : [];
  const orgs = (Array.isArray(raw.orgs) ? raw.orgs : [])
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .filter((n) => !/^\s*(Flipwise|Flipwise Consulting)\s*$/i.test(n));

  // Post-sanitize to catch any leftovers the model didn’t normalize
  const safeTitle = sanitizeOrganizations(raw.title, orgs);
  const safeExcerpt = sanitizeOrganizations(raw.excerpt, orgs);
  const safeContent = raw.content.map((b) => {
    if (!b || typeof b !== 'object') return b;
    if (b.type === 'list' && Array.isArray(b.items)) {
      return { ...b, items: b.items.map((it) => sanitizeOrganizations(String(it), orgs)) };
    }
    if ('text' in b) {
      return { ...b, text: sanitizeOrganizations(String(b.text || ''), orgs) };
    }
    return b;
  });

  return {
    title: safeTitle,
    excerpt: safeExcerpt,
    content: safeContent
  };
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
    transformation: [{ fetch_format: 'auto', quality: 'auto' }]
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
    format: 'png'
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

  // --- Preserve original createdAt if file already exists ---
  const nowIso = new Date().toISOString();
  let createdAt = nowIso;
  const postPath = `public/content/posts/${slug}.json`;

  if (existsSync(postPath)) {
    try {
      const prev = JSON.parse(readFileSync(postPath, 'utf8'));
      createdAt = prev.createdAt || prev.date || createdAt;
    } catch {
      // ignore parse errors and keep createdAt = now
    }
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

  // Build canonical URL for this post (handles hash-router bases like https://site/#/blog)
  const postUrl = buildPostUrl(SITE_BASE_URL, slug);

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
