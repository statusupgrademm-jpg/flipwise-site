import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import OpenAI from 'openai';
import cloudinary from 'cloudinary';
import { writeFile } from 'node:fs/promises';
import { writePost } from './new-post.mjs';

const SOURCE_URL = process.argv[2];
if (!SOURCE_URL) { console.error('Usage: node scripts/ingest-url.mjs <url>'); process.exit(1); }

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';

// Cloudinary reads CLOUDINARY_URL from env (cloudinary://key:secret@cloud)
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

async function genImage(prompt) {
  // Placeholder SVG → Cloudinary. Replace later with actual image-gen API.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900">
  <rect width="100%" height="100%" fill="#111"/><text x="50%" y="50%" fill="#fff" font-size="54" text-anchor="middle" font-family="Arial">${(prompt||'Blog').slice(0,36)}</text></svg>`;
  const tmp = `/tmp/banner-${Date.now()}.svg`;
  await writeFile(tmp, svg, 'utf8');
  const up = await cloudinary.v2.uploader.upload(tmp, { folder: 'flipwise/blog', resource_type: 'image', format: 'png' });
  return up.secure_url;
}

(async () => {
  const raw = await extract(SOURCE_URL);
  const rewritten = await rewrite({ title: raw.title, body: raw.content });
  const slug = slugify(rewritten.title);
  const image = await genImage(rewritten.title);
  const date = new Date().toISOString().slice(0,10);

  await writePost({
    slug,
    title: rewritten.title,
    date,
    excerpt: rewritten.excerpt,
    image,
    content: rewritten.content
  });

  await writeFile(`public/content/posts/${slug}.source.txt`, SOURCE_URL, 'utf8');
  console.log(`Ingested → ${slug}`);
})();
