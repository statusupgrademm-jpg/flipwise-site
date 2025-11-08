import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const indexPath = path.join(root, 'public/content/index.json');
const postsDir = path.join(root, 'public/content/posts');

/**
 * Write a blog post JSON and update index.json
 * Accepts both legacy `date` and modern `createdAt`/`updatedAt`.
 */
export async function writePost({
  slug,
  title,
  // modern fields
  createdAt,
  updatedAt,
  // legacy field (optional)
  date,
  excerpt = '',
  image = '',
  content = []
}) {
  if (!slug || !title) throw new Error('writePost: `slug` and `title` are required');

  const nowIso = new Date().toISOString();
  const created = createdAt
    ? new Date(createdAt).toISOString()
    : (date ? new Date(date).toISOString() : nowIso);
  const updated = updatedAt ? new Date(updatedAt).toISOString() : nowIso;
  const legacyDate = (date || created.slice(0, 10)); // keep YYYY-MM-DD for compatibility

  const post = {
    slug,
    title,
    createdAt: created,
    updatedAt: updated,
    date: legacyDate,
    excerpt,
    image,
    content
  };

  await fs.mkdir(postsDir, { recursive: true });
  await fs.writeFile(
    path.join(postsDir, `${slug}.json`),
    JSON.stringify(post, null, 2),
    'utf8'
  );

  // Load existing index (if any)
  let idx = [];
  try {
    const raw = await fs.readFile(indexPath, 'utf8');
    idx = JSON.parse(raw);
    if (!Array.isArray(idx)) idx = [];
  } catch {
    // no index yet, that's fine
  }

  // Replace existing entry for this slug, then add the updated one
  const without = idx.filter(p => p?.slug !== slug);
  const entry = {
    slug,
    title,
    createdAt: created,
    updatedAt: updated,
    date: legacyDate,
    excerpt,
    image
  };
  without.push(entry);

  // Sort newest first by createdAt
  without.sort((a, b) => {
    const ta = Date.parse(a?.createdAt || a?.date || 0);
    const tb = Date.parse(b?.createdAt || b?.date || 0);
    return tb - ta;
  });

  await fs.writeFile(indexPath, JSON.stringify(without, null, 2), 'utf8');

  return post;
}

// --- CLI usage: node scripts/new-post.mjs <slug> "<title>" [imageUrl] [excerpt...]
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , slug, title, image = '', ...excerptParts] = process.argv;
  if (!slug || !title) {
    console.error('Usage: node scripts/new-post.mjs <slug> "<title>" [imageUrl] [excerpt...]');
    process.exit(1);
  }
  const excerpt = excerptParts.join(' ');
  const nowIso = new Date().toISOString();

  await writePost({
    slug,
    title,
    createdAt: nowIso,
    updatedAt: nowIso,
    excerpt,
    image,
    content: [
      { type: 'subheader', text: 'Intro' },
      { type: 'paragraph', text: 'Draft body…' }
    ]
  });

  console.log(`Created ${slug}`);
}
