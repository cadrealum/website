/* Admin Utilities — shared helpers for the admin tools (and harmless on the
   basic page where most are unused). Load after AuthManager/github-api.js and
   before any tool script that uses them. */

const BLOG_DATA_PATH = 'json/blog-data.json';

// Decode GitHub Contents API base64 (with line breaks) as UTF-8 text.
function decodeBase64Utf8(b64WithBreaks) {
    const binary = atob(b64WithBreaks.replace(/\s/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
}

// Walk announcements + events looking for an entry whose href matches.
// Returns { array, index, entry } or null. Lets callers update either array
// without re-implementing the lookup.
function findEntryByHref(json, href) {
    const arrays = ['announcements', 'events'];
    for (let a = 0; a < arrays.length; a++) {
        const arr = json[arrays[a]];
        if (!Array.isArray(arr)) continue;
        for (let i = 0; i < arr.length; i++) {
            if (arr[i] && arr[i].href === href) {
                return { array: arrays[a], index: i, entry: arr[i] };
            }
        }
    }
    return null;
}

// Load blog-data.json, preferring a staged updateBlogIndex over the server
// copy so the caller sees the admin's in-progress state. Throws on network
// or parse failures so callers can show a useful error.
async function fetchBlogDataJson() {
    const pending = (typeof ChangeQueue !== 'undefined')
        ? ChangeQueue.list().find(function(a) { return a.type === 'updateBlogIndex'; })
        : null;
    if (pending) return JSON.parse(pending.content);
    const resp = await ghFetch('GET', '/contents/' + BLOG_DATA_PATH);
    return JSON.parse(decodeBase64Utf8(resp.content));
}

// Tiny click-binder used by every admin tool's init code.
function bindClick(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
}
