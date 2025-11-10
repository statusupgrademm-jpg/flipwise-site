// scripts/socialImage.js

const CLOUD_FROM_ENV = process.env.CLOUDINARY_CLOUD_NAME || "";

// Correctly parse cloud name from a Cloudinary URL:
// https://res.cloudinary.com/<cloud>/image/upload/...
function parseCloudinary(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/"); // ["", "<cloud>", "image", "upload", ...]
    const cloudFromPath = parts[1] || "";
    if (!cloudFromPath) return null;

    // Try to capture the public_id + ext after /image/upload/(vN/)?...
    const m = u.pathname.match(
      /\/image\/upload\/(?:v\d+\/)?(.+?)(?:\.(jpg|jpeg|png|webp))?$/i
    );
    if (!m) return { cloud: cloudFromPath, publicId: "", ext: "" };

    const publicId = m[1];
    const ext = (m[2] || "").toLowerCase();
    return { cloud: cloudFromPath, publicId, ext };
  } catch {
    return null;
  }
}

export function buildSocialImageUrl(baseUrlOrId, title, opts = {}) {
  const {
    sub = "READ OUR BLOG POST",
    width = 1080,
    height = 1350,
    font = "Montserrat",
  } = opts;

  const H1 = encodeURIComponent(String(title || "").toUpperCase());
  const SUB = encodeURIComponent(String(sub || "").toUpperCase());

  let basePrefix = "";
  let tail = "";

  const isHttp = typeof baseUrlOrId === "string" && baseUrlOrId.startsWith("http");
  const parsed = isHttp ? parseCloudinary(baseUrlOrId) : null;

  if (parsed && parsed.publicId) {
    // Case A: Cloudinary URL with public_id
    basePrefix = `https://res.cloudinary.com/${parsed.cloud}/image/upload`;
    tail = `${parsed.publicId}.jpg`; // force jpeg output
  } else if (typeof baseUrlOrId === "string" && !isHttp) {
    // Case B: given a public_id
    if (!CLOUD_FROM_ENV)
      throw new Error("CLOUDINARY_CLOUD_NAME required for public_id input");
    basePrefix = `https://res.cloudinary.com/${CLOUD_FROM_ENV}/image/upload`;
    tail = `${baseUrlOrId}.jpg`; // force jpeg output
  } else {
    // Case C: remote URL via fetch
    if (!CLOUD_FROM_ENV)
      throw new Error("CLOUDINARY_CLOUD_NAME required for image/fetch input");
    const fetchUrl = encodeURIComponent(baseUrlOrId);
    basePrefix = `https://res.cloudinary.com/${CLOUD_FROM_ENV}/image/fetch`;
    tail = fetchUrl; // format will still be forced by f_jpg below
  }

  // IMPORTANT: force JPEG so IG accepts it
  // - use f_jpg (not f_auto) and q_auto to keep size reasonable
  const parts = [
    basePrefix,
    `c_fill,w_${width},h_${height},q_auto,f_jpg`,
    `e_colorize:70,co_rgb:000000`,
    `l_text:${font}_90_bold:${H1},co_rgb:ffffff,g_center,y_-80,letter_spacing:3`,
    `l_text:${font}_32_bold:${SUB},co_rgb:ffffff,g_center,y_480,letter_spacing:3`,
    tail,
  ];

  return parts.join("/");
}
