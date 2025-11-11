// scripts/linkedinPublish.js
import fetch from "node-fetch";

/**
 * Posts to a LinkedIn Company Page.
 * If IMAGE_URL is present, makes an image post (register + upload + post).
 * Otherwise, posts a text+link share.
 */

const {
    LINKEDIN_TOKEN,            // Bearer
    LINKEDIN_ORG_ID,           // numeric e.g. 109899225
    IMAGE_URL = "",            // Cloudinary URL from ingest step
    POST_TITLE = "",
    POST_EXCERPT = "",
    POST_URL = "",             // canonical blog URL
} = process.env;

function reqHeaders(extra = {}) {
    return {
        Authorization: `Bearer ${LINKEDIN_TOKEN}`,
        "LinkedIn-Version": "202502",
        "X-Restli-Protocol-Version": "2.0.0",
        "Content-Type": "application/json",
        ...extra,
    };
}

async function registerUpload(ownerUrn) {
    const body = {
        registerUploadRequest: {
            recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
            owner: ownerUrn,
            serviceRelationships: [
                { relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" },
            ],
        },
    };
    const r = await fetch("https://api.linkedin.com/v2/assets?action=registerUpload", {
        method: "POST",
        headers: reqHeaders(),
        body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`registerUpload failed: ${r.status} ${JSON.stringify(j)}`);
    const uploadUrl =
        j?.value?.uploadMechanism?.["com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"]?.uploadUrl;
    const asset = j?.value?.asset;
    if (!uploadUrl || !asset) throw new Error(`Bad registerUpload response: ${JSON.stringify(j)}`);
    return { uploadUrl, asset };
}

async function uploadBinary(uploadUrl, imgBuffer) {
    // LinkedIn accepts PUT to mediaUpload URL. Some tenants also accept POST; PUT is safest.
    const r = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" }, // no bearer header needed here
        body: imgBuffer,
    });
    if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`binary upload failed: ${r.status} ${t}`);
    }
}

async function makeImagePost(orgUrn, assetUrn, text) {
    const body = {
        author: orgUrn,
        lifecycleState: "PUBLISHED",
        specificContent: {
            "com.linkedin.ugc.ShareContent": {
                shareCommentary: { text },
                shareMediaCategory: "IMAGE",
                media: [{ status: "READY", media: assetUrn }],
            },
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };
    const r = await fetch("https://api.linkedin.com/v2/ugcPosts", {
        method: "POST",
        headers: reqHeaders(),
        body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`ugcPosts(image) failed: ${r.status} ${JSON.stringify(j)}`);
    return j;
}

async function makeTextPost(orgUrn, text) {
    const body = {
        author: orgUrn,
        lifecycleState: "PUBLISHED",
        specificContent: {
            "com.linkedin.ugc.ShareContent": {
                shareCommentary: { text },
                shareMediaCategory: "NONE",
            },
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    };
    const r = await fetch("https://api.linkedin.com/v2/ugcPosts", {
        method: "POST",
        headers: reqHeaders(),
        body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`ugcPosts(text) failed: ${r.status} ${JSON.stringify(j)}`);
    return j;
}

(async () => {
    if (!LINKEDIN_TOKEN) throw new Error("Missing LINKEDIN_TOKEN");
    if (!LINKEDIN_ORG_ID) throw new Error("Missing LINKEDIN_ORG_ID");

    const orgUrn = `urn:li:organization:${LINKEDIN_ORG_ID}`;
    const caption =
        `${POST_TITLE}\n\n${POST_EXCERPT}\n\n${POST_URL}`.trim().slice(0, 2800); // LI limit safety

    if (IMAGE_URL) {
        // fetch the already-generated Cloudinary image
        const imgRes = await fetch(IMAGE_URL);
        if (!imgRes.ok) throw new Error(`image fetch failed: ${imgRes.status}`);
        const imgBuf = Buffer.from(await imgRes.arrayBuffer());

        const { uploadUrl, asset } = await registerUpload(orgUrn);
        await uploadBinary(uploadUrl, imgBuf);
        const out = await makeImagePost(orgUrn, asset, caption);
        console.log(JSON.stringify({ ok: true, type: "image", out }, null, 2));
    } else {
        const out = await makeTextPost(orgUrn, caption);
        console.log(JSON.stringify({ ok: true, type: "text", out }, null, 2));
    }
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
