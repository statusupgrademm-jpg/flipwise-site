// scripts/socialImage.js
/**
 * Build a Cloudinary URL with:
 * - 70% dark overlay
 * - centered white heading (and optional subline)
 * Works with:
 *   a) Cloudinary URLs (extracts cloud + public_id), or
 *   b) any remote URL via image/fetch (needs CLOUDINARY_CLOUD_NAME env).
 */

const CLOUD_FROM_ENV = process.env.CLOUDINARY_CLOUD_NAME || "";

function parseCloudinary(url) {
  try {
    const u = new URL(url);
    // e.g. https://res.cloudinary.com/<cloud>/image/upload/v123/folder/name.jpg
    const m = u.pathname.match(/\/image\/upload\/(?:v\d+\/)?(.+)\.(jpg|jpeg|png|webp)$/i);
    if (!m) return null;
    return {
      cloud: u.hostname.split(".")[0] === "res" ? u.pathname.split("/")[2] : u.hostname.split(".")[0],
      publicId: m[1],
      ext: m[2].toLowerCase(),
    };
  } catch { return null; }
}

export function buildSocialImageUrl(baseUrlOrId, title, opts = {}) {
  const {
    sub = "SWIPE FOR A SNEAK PEEK",
    width = 1080,
    height = 1350,
    font = "Montserrat",
  } = opts;

  const H1  = encodeURIComponent(String(title || "").toUpperCase());
  const SUB = encodeURIComponent(String(sub || "").toUpperCase());

  // If it’s a Cloudinary URL, keep its cloud + public_id
  const parsed = typeof baseUrlOrId === "string" && baseUrlOrId.startsWith("http")
    ? parseCloudinary(baseUrlOrId)
    : null;

  let basePrefix = "", tail = "";
  if (parsed) {
    basePrefix = `https://res.cloudinary.com/${parsed.cloud}/image/upload`;
    tail = `${parsed.publicId}.${parsed.ext}`;
  } else if (typeof baseUrlOrId === "string" && !baseUrlOrId.startsWith("http")) {
    // treat as public_id
    if (!CLOUD_FROM_ENV) throw new Error("CLOUDINARY_CLOUD_NAME required for public_id input");
    basePrefix = `https://res.cloudinary.com/${CLOUD_FROM_ENV}/image/upload`;
    tail = `${baseUrlOrId}.jpg`;
  } else {
    // remote URL via fetch
    if (!CLOUD_FROM_ENV) throw new Error("CLOUDINARY_CLOUD_NAME required for image/fetch input");
    const fetchUrl = encodeURIComponent(baseUrlOrId);
    basePrefix = `https://res.cloudinary.com/${CLOUD_FROM_ENV}/image/fetch`;
    tail = fetchUrl;
  }

  // Compose: crop to IG portrait, darken, then overlay heading + sub
  const parts = [
    basePrefix,
    `c_fill,w_${width},h_${height},q_auto,f_auto`,
    `e_colorize:70,co_rgb:000000`,
    `l_text:${font}_90_bold:${H1},co_rgb:ffffff,g_center,y_-80,letter_spacing:3`,
    `l_text:${font}_32_bold:${SUB},co_rgb:ffffff,g_center,y_480,letter_spacing:3`,
    tail,
  ];

  return parts.join("/");
}
