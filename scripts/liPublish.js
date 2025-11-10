// scripts/liPublish.js
// Publish a blog link to LinkedIn (Page or Person) using REST API.
// Requires env: LINKEDIN_TOKEN, LINKEDIN_ACTOR_URN, and post data from workflow env.

const LKV = '202502'; // LinkedIn-Version header (YYYYMM)

// --- helpers ---
function liFetch(url, { token, ...init } = {}) {
    return fetch(url, {
        ...init,
        headers: {
            Authorization: `Bearer ${token}`,
            'X-Restli-Protocol-Version': '2.0.0',
            'LinkedIn-Version': LKV,
            ...(init.headers || {}),
        },
    });
}

async function liInitImageUpload({ token, ownerUrn }) {
    const r = await liFetch('https://api.linkedin.com/rest/images?action=initializeUpload', {
        token,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ initializeUploadRequest: { owner: ownerUrn } }),
    });
    if (!r.ok) throw new Error(`LinkedIn init image failed: ${r.status} ${await r.text()}`);
    const { value } = await r.json();
    return { uploadUrl: value.uploadUrl, imageUrn: value.image };
}

async function liUploadImageToUrl({ uploadUrl, arrayBuffer, contentType = 'image/jpeg' }) {
    const r = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: arrayBuffer });
    if (!r.ok) throw new Error(`LinkedIn image upload failed: ${r.status} ${await r.text()}`);
}

async function liCreateArticlePost({ token, authorUrn, commentary, url, title, description, thumbnailImageUrn }) {
    const r = await liFetch('https://api.linkedin.com/rest/posts', {
        token,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            author: authorUrn, // urn:li:organization:... OR urn:li:person:...
            commentary,
            visibility: 'PUBLIC',
            distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
            content: {
                article: {
                    source: url,
                    thumbnail: thumbnailImageUrn,
                    title,
                    description,
                },
            },
            lifecycleState: 'PUBLISHED',
            isReshareDisabledByAuthor: false,
        }),
    });
    if (!r.ok) throw new Error(`LinkedIn post failed: ${r.status} ${await r.text()}`);
    return r.headers.get('x-restli-id');
}

// --- main ---
(async () => {
    try {
        const {
            LINKEDIN_TOKEN,
            LINKEDIN_ACTOR_URN,   // e.g. urn:li:organization:123456 or urn:li:person:abcdef
            LI_IMAGE_URL,         // from ingest output (Cloudinary)
            LI_TITLE,             // from ingest output
            LI_DESCRIPTION,       // from ingest output (excerpt)
            LI_URL,               // canonical blog URL
            LI_COMMENTARY,        // optional custom social text
        } = process.env;

        if (!LINKEDIN_TOKEN || !LINKEDIN_ACTOR_URN) {
            throw new Error('Missing env: LINKEDIN_TOKEN or LINKEDIN_ACTOR_URN');
        }
        if (!LI_URL || !LI_TITLE || !LI_IMAGE_URL) {
            throw new Error('Missing env: LI_URL or LI_TITLE or LI_IMAGE_URL');
        }

        const commentary =
            (LI_COMMENTARY && LI_COMMENTARY.trim()) ||
            `${LI_TITLE} — ${(LI_DESCRIPTION || '').trim()}`.slice(0, 600);

        // 1) fetch hero image bytes
        const imgRes = await fetch(LI_IMAGE_URL);
        if (!imgRes.ok) throw new Error(`Fetch hero image failed: ${imgRes.status}`);
        const buf = await imgRes.arrayBuffer();
        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';

        // 2) init upload -> upload image
        const { uploadUrl, imageUrn } = await liInitImageUpload({
            token: LINKEDIN_TOKEN,
            ownerUrn: LINKEDIN_ACTOR_URN,
        });
        await liUploadImageToUrl({ uploadUrl, arrayBuffer: buf, contentType });

        // 3) create article post
        const postUrn = await liCreateArticlePost({
            token: LINKEDIN_TOKEN,
            authorUrn: LINKEDIN_ACTOR_URN,
            commentary,
            url: LI_URL,
            title: LI_TITLE,
            description: LI_DESCRIPTION || '',
            thumbnailImageUrn: imageUrn,
        });

        console.log('✅ LinkedIn published:', postUrn);
    } catch (err) {
        console.error('❌ LinkedIn publish failed:', err.message);
        process.exit(1);
    }
})();
