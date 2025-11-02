import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const indexPath = path.join(root, 'public/content/index.json');
const postsDir = path.join(root, 'public/content/posts');

export async function writePost({slug, title, date, excerpt, image, content}) {
  await fs.mkdir(postsDir, { recursive: true });
  const post = { slug, title, date, excerpt, image, content };
  await fs.writeFile(path.join(postsDir, `${slug}.json`), JSON.stringify(post, null, 2), 'utf8');

  let idx = [];
  try { idx = JSON.parse(await fs.readFile(indexPath, 'utf8')); } catch {}
  const without = idx.filter(p => p.slug !== slug);
  without.unshift({ slug, title, date, excerpt, image });
  await fs.writeFile(indexPath, JSON.stringify(without, null, 2), 'utf8');
}

// allow CLI usage too
if (import.meta.url === `file://${process.argv[1]}`) {
  const [,, slug, title, image = '', ...excerptParts] = process.argv;
  if (!slug || !title) {
    console.error('Usage: node scripts/new-post.mjs <slug> "<title>" [imageUrl] [excerpt...]');
    process.exit(1);
  }
  const excerpt = excerptParts.join(' ');
  const date = new Date().toISOString().slice(0,10);
  await writePost({
    slug, title, date, excerpt, image,
    content: [
      { type: 'subheader', text: 'Intro' },
      { type: 'paragraph', text: 'Draft body…' }
    ]
  });
  console.log(`Created ${slug}`);
}
