// scripts/renderSocialImage.js
import fetch from "node-fetch";
import sharp from "sharp";

/** naive word-wrap into lines up to maxChars each */
function wrapLines(text, maxChars = 26, maxLines = 3) {
  const words = String(text || "").split(/\s+/);
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? line + " " + w : w;
    if (next.length <= maxChars) {
      line = next;
    } else {
      lines.push(line);
      line = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);
  return lines;
}

/** Build overlay SVG (dark bg + white texts) at 1080x1350 */
function buildOverlaySVG({ width, height, title, sub }) {
  const titleLines = wrapLines((title || "").toUpperCase(), 26, 3);
  const subLines = wrapLines((sub || "").toUpperCase(), 30, 2);

  const cx = width / 2;
  const titleYStart = height / 2 - 120;
  const subYStart = height / 2 + 240;

  const titleSvg = titleLines
    .map((ln, i) => {
      const y = titleYStart + i * 84;
      return `<text x="${cx}" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="64" font-weight="700" fill="#FFFFFF">${escapeHtml(
        ln
      )}</text>`;
    })
    .join("");

  const subSvg = subLines
    .map((ln, i) => {
      const y = subYStart + i * 56;
      return `<text x="${cx}" y="${y}" text-anchor="middle" font-family="sans-serif" font-size="36" font-weight="700" fill="#FFFFFF">${escapeHtml(
        ln
      )}</text>`;
    })
    .join("");

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <rect x="0" y="0" width="${width}" height="${height}" fill="black" fill-opacity="0.7"/>
      ${titleSvg}
      ${subSvg}
    </svg>`
  );
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Render a social JPG with overlay + text.
 * @param {string} baseUrl - public image URL
 * @param {object} opts
 *   - width, height: final size (default 1080x1350)
 *   - title, sub: overlay texts
 * @returns {Promise<Buffer>} JPG buffer
 */
export async function renderSocialImage(baseUrl, opts = {}) {
  const width = opts.width ?? 1080;
  const height = opts.height ?? 1350; // 4:5 for IG
  const title = opts.title ?? "";
  const sub = opts.sub ?? "SWIPE FOR A SNEAK PEEK";

  const res = await fetch(baseUrl);
  if (!res.ok) throw new Error(`Failed to download base image: ${res.status}`);
  const baseBuf = Buffer.from(await res.arrayBuffer());

  const overlaySvg = buildOverlaySVG({ width, height, title, sub });

  const out = await sharp(baseBuf)
    .resize({ width, height, fit: "cover", position: "attention" })
    .composite([{ input: overlaySvg }])
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();

  return out;
}
