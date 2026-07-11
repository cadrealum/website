/* Draft Manager — admin tool.
   Saves the in-progress post to GitHub as a layout-JSON draft WITHOUT
   publishing it, and lists / loads / deletes existing drafts under drafts/.

   Drafts use the exact getSaveData() / applySaveData() shape (post-gen.js), so
   a draft round-trips through the editor identically to the local Save As /
   Load. Saves and deletes are staged on the shared ChangeQueue as `saveDraft` /
   `deleteFile` actions and commit through the normal 💾 Commit flow.

   Loaded on tools/post-generator-admin.html after admin-tool-manager.js,
   change-queue.js, AuthManager/github-api.js, and post-gen.js (getSaveData,
   applySaveData, slugify, state, escHtml). decodeBase64Utf8 + bindClick come
   from tools/js/admin-utils.js. */

const DRAFTS_DIR = 'drafts';

let dmLoaded = false;
let dmLoading = false;
let dmItems = [];              // last-fetched server list: [{name, path, sha, title, date}]
let dmCtxMenuEl = null;
let dmPendingDelete = null;    // {name, path, sha} awaiting delete-modal confirm
let dmPendingLoad = null;      // {name, path, sha} awaiting load-modal confirm

// Server listing of drafts/*.json (with title/date pulled from each file for
// the row label). Returns [] when the folder doesn't exist yet.
async function dmFetchDrafts() {
    let items;
    try {
        items = await ghFetch('GET', '/contents/' + DRAFTS_DIR);
    } catch (err) {
        if (err.status === 404) return [];   // folder not created on the server yet
        throw err;
    }
    if (!Array.isArray(items)) return [];
    const files = items.filter(function(it) {
        return it.type === 'file' && /\.json$/i.test(it.name);
    });
    return Promise.all(files.map(async function(it) {
        let title = '', date = '';
        try {
            const resp = await ghFetch('GET', '/contents/' + it.path);
            const td = dmParseTitleDate(decodeBase64Utf8(resp.content));
            title = td.title; date = td.date;
        } catch (e) { /* keep a name-only row if a draft fails to parse */ }
        return { name: it.name, path: it.path, sha: it.sha, title: title, date: date };
    }));
}

function dmParseTitleDate(jsonStr) {
    try {
        const d = JSON.parse(jsonStr);
        return { title: (d.fields && d.fields.title) || '', date: (d.fields && d.fields.date) || '' };
    } catch (e) { return { title: '', date: '' }; }
}

// Pending (staged, uncommitted) queue state ---------------------------
function dmPendingSaveActions() {
    return ChangeQueue.list().filter(function(a) { return a.type === 'saveDraft'; });
}
function dmPendingDeletePaths() {
    const s = new Set();
    ChangeQueue.list().forEach(function(a) {
        if (a.type === 'deleteFile' && a.path.indexOf(DRAFTS_DIR + '/') === 0) s.add(a.path);
    });
    return s;
}

// Resolve a row path back to an item — server list first, then a pending save.
function dmFindRow(path) {
    const server = dmItems.find(function(x) { return x.path === path; });
    if (server) return server;
    const save = dmPendingSaveActions().find(function(a) { return a.path === path; });
    if (save) {
        const td = dmParseTitleDate(save.content);
        return { name: path.slice(DRAFTS_DIR.length + 1), path: path, sha: null, title: td.title, date: td.date };
    }
    return null;
}

function dmRender() {
    const body = document.getElementById('draft-manager-body');
    if (!body) return;

    const pendingSaves = dmPendingSaveActions();
    const pendingSavePaths = new Set(pendingSaves.map(function(a) { return a.path; }));
    const pendingDeletes = dmPendingDeletePaths();

    // Merge server drafts with pending-only saves (never-committed drafts).
    const rows = dmItems.slice();
    const seen = new Set(rows.map(function(r) { return r.path; }));
    pendingSaves.forEach(function(a) {
        if (seen.has(a.path)) return;
        const td = dmParseTitleDate(a.content);
        rows.push({ name: a.path.slice(DRAFTS_DIR.length + 1), path: a.path, sha: null, title: td.title, date: td.date });
    });
    rows.sort(function(a, b) { return a.name.localeCompare(b.name); });

    if (!rows.length) {
        body.innerHTML = '<div class="draft-manager-placeholder">No saved drafts yet. '
            + 'Use “💾 Save Draft” to store your work in progress on GitHub.</div>';
        return;
    }

    body.innerHTML = '<ul class="draft-manager-files">'
        + rows.map(function(it) {
            const isDelete = pendingDeletes.has(it.path);
            const isSave = pendingSavePaths.has(it.path);
            let cls = 'draft-manager-item';
            if (isDelete) cls += ' draft-manager-item-pending-delete';
            let tag = '';
            if (isDelete)      tag = '<span class="draft-manager-tag draft-manager-tag-delete">−PENDING DELETE</span>';
            else if (isSave)   tag = '<span class="draft-manager-tag draft-manager-tag-save">+PENDING SAVE</span>';
            const metaText = [it.title, it.date].filter(Boolean).join(' · ');
            const meta = metaText ? '<span class="draft-manager-meta">' + escHtml(metaText) + '</span>' : '';
            return '<li class="' + cls + '" data-path="' + escHtml(it.path) + '" title="' + escHtml(it.path) + '">'
                 + '<span class="draft-manager-icon">📝</span>'
                 + '<span class="draft-manager-name">' + escHtml(it.name) + meta + '</span>'
                 + tag
                 + '</li>';
        }).join('')
        + '</ul>';
}

async function dmLoadAndRender() {
    const body = document.getElementById('draft-manager-body');
    if (!body || dmLoading) return;
    dmLoading = true;
    body.innerHTML = '<div class="draft-manager-placeholder">Loading…</div>';
    try {
        dmItems = await dmFetchDrafts();
        dmLoaded = true;
        dmRender();
    } catch (err) {
        body.innerHTML = '<div class="draft-manager-placeholder draft-manager-error">'
                       + escHtml(err.message || String(err))
                       + '<br><br><button class="admin-tool-btn" id="dm-retry">Retry</button>'
                       + '</div>';
        const r = document.getElementById('dm-retry');
        if (r) r.addEventListener('click', function() { dmLoaded = false; dmLoadAndRender(); });
    } finally {
        dmLoading = false;
    }
}

// Save the current builder state as a draft ---------------------------
function dmSaveDraft() {
    if (typeof getSaveData !== 'function') { alert('Editor not ready — refresh and try again.'); return; }
    if (typeof state !== 'undefined' && !state.templateId) {
        alert('Choose a template and add some content before saving a draft.');
        return;
    }
    const data = getSaveData();
    const fields = data.fields || {};
    const slug = slugify(fields.filename || fields.title || '') || 'untitled-blog-post';
    const path = DRAFTS_DIR + '/' + slug + '.json';
    const content = JSON.stringify(data, null, 2);

    // replaceOrAdd dedups when the same draft is saved again before committing.
    ChangeQueue.replaceOrAdd(
        function(a) { return a.type === 'saveDraft' && a.path === path; },
        { type: 'saveDraft', path: path, content: content }
    );

    if (typeof AdminToolManager !== 'undefined') AdminToolManager.open('show-changes');
}

// Delete flow ---------------------------------------------------------
function dmRequestDelete(item) {
    dmPendingDelete = item;
    const overlay = document.getElementById('draft-delete-modal-overlay');
    if (!overlay) return;
    const body = document.getElementById('draft-delete-body');
    if (body) body.innerHTML =
        'Queues deletion of <code>' + escHtml(item.path) + '</code>. '
      + 'It commits when you Commit.';
    overlay.style.display = 'flex';
}

function dmCloseDeleteModal() {
    const o = document.getElementById('draft-delete-modal-overlay');
    if (o) o.style.display = 'none';
    dmPendingDelete = null;
}

function dmDropPendingSave(path) {
    const list = ChangeQueue.list();
    for (let i = 0; i < list.length; i++) {
        if (list[i].type === 'saveDraft' && list[i].path === path) { ChangeQueue.removeAt(i); return true; }
    }
    return false;
}

function dmConfirmDelete() {
    if (!dmPendingDelete) return;
    const item = dmPendingDelete;
    dmCloseDeleteModal();

    // Drop any staged (uncommitted) save for this path first — otherwise the
    // commit would put and delete the same file in one batch.
    dmDropPendingSave(item.path);

    // Only stage a deleteFile when the draft actually exists on the server.
    // A never-committed draft is fully removed by dropping its pending save.
    if (item.sha) {
        ChangeQueue.replaceOrAdd(
            function(a) { return a.type === 'deleteFile' && a.path === item.path; },
            { type: 'deleteFile', path: item.path, sha: item.sha }
        );
    }

    if (typeof AdminToolManager !== 'undefined') AdminToolManager.open('show-changes');
}

// Load flow -----------------------------------------------------------
function dmRequestLoad(item) {
    dmPendingLoad = item;
    if (dmBuilderIsEmpty()) { dmConfirmLoad(); return; }   // nothing to overwrite
    const overlay = document.getElementById('draft-load-modal-overlay');
    if (!overlay) return;
    const nameEl = document.getElementById('draft-load-name');
    if (nameEl) nameEl.textContent = item.path;
    overlay.style.display = 'flex';
}

function dmCloseLoadModal() {
    const o = document.getElementById('draft-load-modal-overlay');
    if (o) o.style.display = 'none';
    dmPendingLoad = null;
}

function dmBuilderIsEmpty() {
    if (typeof state === 'undefined') return true;
    if (state.blocks && state.blocks.length) return false;
    if (state.contributors && state.contributors.length) return false;
    const ids = ['f-title', 'f-author', 'f-thumbnail', 'f-end-date', 'f-filename'];
    for (let i = 0; i < ids.length; i++) {
        const el = document.getElementById(ids[i]);
        if (el && el.value && el.value.trim()) return false;
    }
    return true;
}

async function dmConfirmLoad() {
    if (!dmPendingLoad) return;
    const item = dmPendingLoad;
    dmCloseLoadModal();
    if (typeof applySaveData !== 'function') { alert('Editor not ready — refresh and try again.'); return; }
    try {
        // Prefer a pending (uncommitted) save for this path over the server copy.
        const pendingSave = dmPendingSaveActions().find(function(a) { return a.path === item.path; });
        let jsonStr;
        if (pendingSave) {
            jsonStr = pendingSave.content;
        } else {
            const resp = await ghFetch('GET', '/contents/' + item.path);
            jsonStr = decodeBase64Utf8(resp.content);
        }
        const data = JSON.parse(jsonStr);

        // Clear lingering form values applySaveData won't overwrite (it only
        // sets fields whose data.fields values are truthy).
        ['f-title', 'f-author', 'f-thumbnail', 'f-end-date', 'f-filename'].forEach(function(id) {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        applySaveData(data);

        if (typeof AdminToolManager !== 'undefined') AdminToolManager.close('draft-manager');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
        alert('Failed to load draft: ' + (err.message || err));
    }
}

// Context menu --------------------------------------------------------
function dmShowContextMenu(e, item) {
    e.preventDefault();
    dmHideContextMenu();
    const menu = document.createElement('div');
    menu.className = 'admin-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top  = e.clientY + 'px';

    const isPendingDelete = dmPendingDeletePaths().has(item.path);

    const load = document.createElement('div');
    load.className = 'admin-context-menu-item' + (isPendingDelete ? ' admin-context-menu-item-disabled' : '');
    load.textContent = 'Load draft';
    if (isPendingDelete) load.title = 'Undo the pending delete first';
    else load.addEventListener('click', function() { dmHideContextMenu(); dmRequestLoad(item); });
    menu.appendChild(load);

    const del = document.createElement('div');
    del.className = 'admin-context-menu-item';
    del.textContent = 'Delete draft';
    del.addEventListener('click', function() { dmHideContextMenu(); dmRequestDelete(item); });
    menu.appendChild(del);

    document.body.appendChild(menu);
    dmCtxMenuEl = menu;
    const rect = menu.getBoundingClientRect();
    if (rect.right  > window.innerWidth)  menu.style.left = (window.innerWidth  - rect.width  - 4) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top  = (window.innerHeight - rect.height - 4) + 'px';
}

function dmHideContextMenu() {
    if (dmCtxMenuEl) { dmCtxMenuEl.remove(); dmCtxMenuEl = null; }
}

// Bootstrap -----------------------------------------------------------
function dmInit() {
    if (document.body.dataset.pageRole !== 'admin') return;

    AdminToolManager.register({
        id:      'draft-manager',
        label:   '📝 Drafts',
        panelId: 'draft-manager-panel',
        order:   25,
        onOpen:  function() { if (!dmLoaded) dmLoadAndRender(); else dmRender(); }
    });

    // Re-render on any queue change (pending save/delete tags) and drop the
    // stale server cache after a successful commit.
    ChangeQueue.subscribe(dmRender);
    ChangeQueue.onCommitSuccess(function() {
        if (dmLoaded) { dmLoaded = false; dmLoadAndRender(); }
    });

    bindClick('draft-manager-close',  function() { AdminToolManager.close('draft-manager'); });
    bindClick('draft-manager-reload', function() { if (dmLoading) return; dmLoaded = false; dmLoadAndRender(); });
    bindClick('draft-manager-save',   dmSaveDraft);
    bindClick('btn-save-draft',       dmSaveDraft);   // header action

    const body = document.getElementById('draft-manager-body');
    if (body) {
        body.addEventListener('click', function(e) {
            const row = e.target.closest('.draft-manager-item');
            if (!row || !row.dataset.path) return;
            if (row.classList.contains('draft-manager-item-pending-delete')) return;
            const item = dmFindRow(row.dataset.path);
            if (item) dmRequestLoad(item);
        });
        body.addEventListener('contextmenu', function(e) {
            const row = e.target.closest('.draft-manager-item');
            if (!row || !row.dataset.path) return;
            const item = dmFindRow(row.dataset.path);
            if (item) dmShowContextMenu(e, item);
        });
    }

    // Delete-modal wiring
    const dOverlay = document.getElementById('draft-delete-modal-overlay');
    if (dOverlay) dOverlay.addEventListener('click', function(e) {
        if (e.target === dOverlay) dmCloseDeleteModal();
    });
    bindClick('draft-delete-cancel',  dmCloseDeleteModal);
    bindClick('draft-delete-confirm', dmConfirmDelete);

    // Load-modal wiring
    const lOverlay = document.getElementById('draft-load-modal-overlay');
    if (lOverlay) lOverlay.addEventListener('click', function(e) {
        if (e.target === lOverlay) dmCloseLoadModal();
    });
    bindClick('draft-load-cancel',  dmCloseLoadModal);
    bindClick('draft-load-confirm', dmConfirmLoad);

    document.addEventListener('click', function(e) {
        if (dmCtxMenuEl && !dmCtxMenuEl.contains(e.target)) dmHideContextMenu();
    });
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Escape') return;
        dmHideContextMenu();
        dmCloseDeleteModal();
        dmCloseLoadModal();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', dmInit);
} else {
    dmInit();
}
