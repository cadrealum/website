/* GitHub API client — shared by all admin tools that read or write the repo.
   Loaded after AuthManager/auth.js so getStoredToken / GITHUB_OWNER / GITHUB_REPO
   are in scope.

   Public surface:
     ghFetch(method, path, body?, timeoutMs?)        — low-level wrapped fetch with timeout
     ghGetRef(branch)                                — get a branch's current ref (commit SHA)
     ghGetCommit(sha)                                — get a commit by SHA (includes its tree SHA)
     ghGetTree(treeish, recursive?)                  — get a tree (branch name or SHA)
     ghCreateBlob(base64Content)                     — create a blob from base64 content
     ghCreateTree(baseTreeSha, entries)              — create a new tree (entries with sha:null = delete)
     ghCreateCommit(message, treeSha, parentSha)     — create a commit
     ghUpdateRef(branch, commitSha, force?)          — advance a branch to a commit
     ghStringToBase64(s)                             — UTF-8 safe string → base64
     ghBatchCommit({message, changes, branch?})      — bundle many file changes into ONE commit

   ghBatchCommit is the high-level entry point most callers want. Use the lower
   helpers only when you need finer control (custom commit author, multi-parent
   merge commits, etc.).
*/

const GH_API_BASE = 'https://api.github.com';
const GH_DEFAULT_TIMEOUT_MS = 30000;

function ghHeaders() {
    const headers = { 'Accept': 'application/vnd.github+json' };
    const token = (typeof getStoredToken === 'function') ? getStoredToken() : '';
    if (token) headers['Authorization'] = 'Bearer ' + token;
    return headers;
}

function ghJsonHeaders() {
    return Object.assign(ghHeaders(), { 'Content-Type': 'application/json' });
}

/**
 * Low-level wrapped fetch. Resolves to parsed JSON on 2xx; throws an Error with
 * `.status`, `.statusText`, and `.responseBody` properties on non-2xx. Times out
 * (and throws with `.timedOut = true`) after `timeoutMs` (default 30s).
 */
async function ghFetch(method, path, body, timeoutMs) {
    const url = GH_API_BASE + '/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + path;
    const opts = { method: method, headers: body ? ghJsonHeaders() : ghHeaders() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const controller = new AbortController();
    const t = timeoutMs || GH_DEFAULT_TIMEOUT_MS;
    const timeoutId = setTimeout(function() { controller.abort(); }, t);
    opts.signal = controller.signal;
    try {
        const res = await fetch(url, opts);
        if (!res.ok) {
            const text = await res.text().catch(function() { return ''; });
            const err = new Error(method + ' ' + path + ' — ' + res.status + ' ' + res.statusText
                                + (text ? ': ' + text.slice(0, 300) : ''));
            err.status = res.status;
            err.statusText = res.statusText;
            err.responseBody = text;
            throw err;
        }
        // DELETE responses can be empty on 204 — guard against that
        if (res.status === 204) return null;
        return res.json();
    } catch (err) {
        if (err.name === 'AbortError') {
            const e = new Error(method + ' ' + path + ' timed out after ' + t + 'ms');
            e.status = 0;
            e.timedOut = true;
            throw e;
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

// Read endpoints --------------------------------------------------------------
async function ghGetRef(branch)              { return ghFetch('GET', '/git/refs/heads/' + branch); }
async function ghGetCommit(sha)              { return ghFetch('GET', '/git/commits/' + sha); }
async function ghGetTree(treeish, recursive) { return ghFetch('GET', '/git/trees/' + treeish + (recursive ? '?recursive=1' : '')); }

// Write endpoints (Git Data API — the building blocks of a commit) ------------
async function ghCreateBlob(base64Content)              { return ghFetch('POST', '/git/blobs', { content: base64Content, encoding: 'base64' }); }
async function ghCreateTree(baseTreeSha, entries)       { return ghFetch('POST', '/git/trees', { base_tree: baseTreeSha, tree: entries }); }
async function ghCreateCommit(message, treeSha, parentSha) { return ghFetch('POST', '/git/commits', { message: message, tree: treeSha, parents: [parentSha] }); }
async function ghUpdateRef(branch, commitSha, force)    { return ghFetch('PATCH', '/git/refs/heads/' + branch, { sha: commitSha, force: !!force }); }

/**
 * UTF-8 safe string → base64. Use this for text content (e.g. .gitkeep, README updates).
 * For binary data already in base64 form (e.g. images read via FileReader.readAsDataURL),
 * pass the base64 string directly via the {op:'putB64'} change shape — don't re-encode.
 */
function ghStringToBase64(s) {
    if (typeof s !== 'string') throw new Error('ghStringToBase64: expected string, got ' + typeof s);
    const bytes = new TextEncoder().encode(s);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}

/**
 * Bundle multiple file changes into ONE commit on the given branch.
 *
 * Each change has shape:
 *   { op: 'put',    path, content }   — text content; UTF-8 base64 encoded for you
 *   { op: 'putB64', path, base64 }    — content is already base64 (use for binary uploads)
 *   { op: 'delete', path }            — remove the file at path
 *
 * On a non-fast-forward race (someone else pushed to the branch while we were
 * assembling the commit), the function auto-retries once from scratch with a
 * fresh parent ref. If that retry also loses the race, the error is thrown.
 *
 * @param {Object} opts
 * @param {string} opts.message              commit message
 * @param {Array}  opts.changes              list of change descriptors (see above)
 * @param {string} [opts.branch='main']      target branch
 * @param {boolean} [opts.autoRetry=true]    retry once on non-fast-forward
 * @returns {Promise<{commitSha, commitUrl, treeSha, retried}>}
 */
async function ghBatchCommit(opts) {
    const message   = opts.message;
    const changes   = opts.changes || [];
    const branch    = opts.branch || 'main';
    const autoRetry = opts.autoRetry !== false;
    if (!message) throw new Error('ghBatchCommit: message is required');
    if (!changes.length) throw new Error('ghBatchCommit: changes[] cannot be empty');

    let attempt = 0;
    let retried = false;
    while (true) {
        attempt++;
        try {
            const result = await ghBatchCommitOnce(message, changes, branch);
            result.retried = retried;
            return result;
        } catch (err) {
            const body = err.responseBody || '';
            const isRace = err.status === 422 && /fast.?forward|update is not a fast/i.test(body);
            if (isRace && autoRetry && attempt === 1) {
                retried = true;
                continue;
            }
            throw err;
        }
    }
}

async function ghBatchCommitOnce(message, changes, branch) {
    // 1. Parent ref + commit + tree
    const ref          = await ghGetRef(branch);
    const parentSha    = ref.object.sha;
    const parentCommit = await ghGetCommit(parentSha);
    const baseTreeSha  = parentCommit.tree.sha;

    // 2. Create blobs for additions. Deletes don't need blobs.
    const blobByIndex = new Map();
    for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        if (c.op === 'put') {
            const blob = await ghCreateBlob(ghStringToBase64(c.content || ''));
            blobByIndex.set(i, blob.sha);
        } else if (c.op === 'putB64') {
            const blob = await ghCreateBlob(c.base64);
            blobByIndex.set(i, blob.sha);
        } else if (c.op !== 'delete') {
            throw new Error('ghBatchCommit: unknown op "' + c.op + '"');
        }
    }

    // 3. Tree entries — sha:null means "remove this path from base_tree".
    const entries = changes.map(function(c, i) {
        const e = { path: c.path, mode: '100644', type: 'blob' };
        e.sha = (c.op === 'delete') ? null : blobByIndex.get(i);
        return e;
    });

    // 4. New tree (built on top of base_tree)
    const newTree = await ghCreateTree(baseTreeSha, entries);

    // 5. New commit pointing at the new tree, parented on the old commit
    const newCommit = await ghCreateCommit(message, newTree.sha, parentSha);

    // 6. Advance the branch ref. force=false ⇒ fails 422 on non-fast-forward.
    await ghUpdateRef(branch, newCommit.sha, false);

    return {
        commitSha: newCommit.sha,
        commitUrl: newCommit.html_url || newCommit.url,
        treeSha:   newTree.sha
    };
}
