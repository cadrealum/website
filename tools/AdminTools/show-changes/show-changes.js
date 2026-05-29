/* Show Changes — admin tool that displays ChangeQueue contents.

   Owns the commit flow: both the sidebar Commit button (#btn-commit) and the
   in-panel Commit button (#show-changes-commit) call scCommitFromUser(),
   which opens the confirmation modal and on confirm fires ghBatchCommit.

   Loaded on tools/post-generator-admin.html after admin-tool-manager.js,
   change-queue.js, and post-gen.js (escHtml). */

let scCtxMenuEl = null;
let scCommitting = false;

// Render --------------------------------------------------------------
function scRender() {
    const body = document.getElementById('show-changes-body');
    if (!body) {
        scUpdateToolbar();
        scUpdateSidebarCommit();
        return;
    }
    const list = ChangeQueue.list();
    if (list.length === 0) {
        body.innerHTML = '<div class="show-changes-placeholder">No pending changes.</div>';
    } else {
        body.innerHTML = '<ul class="show-changes-list">'
            + list.map(function(a, i) {
                return '<li class="show-changes-item" data-i="' + i + '">'
                     + scTypeTag(a)
                     + '<span class="show-changes-item-label">' + escHtml(ChangeQueue.labelFor(a)) + '</span>'
                     + '</li>';
            }).join('')
            + '</ul>';
    }
    scUpdateToolbar();
    scUpdateSidebarCommit();
}

function scTypeTag(action) {
    const type = action.type;

    // Overwrite covers three cases:
    //   1. publishHtml carrying an originalEntry — editing an existing blog
    //   2. updateBlogIndex — always replaces the existing blog-data.json
    //   3. uploadFile flagged overwrite — replacing an image that exists on
    //      the server snapshot (set by image-manager when staging)
    const isOverwrite =
        (type === 'publishHtml' && action.originalEntry) ||
        type === 'updateBlogIndex' ||
        (type === 'uploadFile' && action.overwrite);
    if (isOverwrite)
        return '<span class="show-changes-tag show-changes-tag-overwrite">+overwrite</span>';

    if (type === 'createFolder' || type === 'uploadFile' || type === 'publishHtml')
        return '<span class="show-changes-tag show-changes-tag-add">+upload</span>';

    if (type === 'deleteFile' || type === 'deleteFolder' || type === 'unpublishHtml')
        return '<span class="show-changes-tag show-changes-tag-del">−delete</span>';

    return '<span class="show-changes-tag">' + escHtml(type) + '</span>';
}

function scUpdateToolbar() {
    const n = ChangeQueue.length;
    const disabled = n === 0 || scCommitting;
    const undo   = document.getElementById('show-changes-undo');
    const reset  = document.getElementById('show-changes-reset');
    const commit = document.getElementById('show-changes-commit');
    if (undo)   undo.disabled  = disabled;
    if (reset)  reset.disabled = disabled;
    if (commit) {
        commit.disabled = disabled;
        commit.innerHTML = n > 0 ? '💾 Commit (' + n + ')' : '💾 Commit';
    }
}

function scUpdateSidebarCommit() {
    const btn = document.getElementById('btn-commit');
    if (!btn) return;
    const n = ChangeQueue.length;
    btn.disabled = n === 0 || scCommitting;
    btn.innerHTML = n > 0 ? '💾 Commit (' + n + ')' : '💾 Commit';
}

// Actions -------------------------------------------------------------
function scUndo()  { if (!scCommitting) ChangeQueue.pop(); }
function scReset() { if (!scCommitting) ChangeQueue.clear(); }

function scCommitFromUser() {
    if (!ChangeQueue.length || scCommitting) return;
    AdminToolManager.open('show-changes');
    scOpenCommitModal();
}

// Commit confirmation modal ------------------------------------------
function scOpenCommitModal() {
    const overlay = document.getElementById('commit-modal-overlay');
    if (!overlay) return;
    const list = ChangeQueue.list();
    const count1 = document.getElementById('commit-modal-count');
    if (count1) count1.textContent = list.length;
    const listEl = document.getElementById('commit-modal-list');
    if (listEl) listEl.innerHTML = list.map(function(a) {
        return '<li>' + escHtml(ChangeQueue.labelFor(a)) + '</li>';
    }).join('');
    const nameInput = document.getElementById('commit-modal-name');
    if (nameInput) {
        nameInput.value = '';
        nameInput.placeholder = ChangeQueue.summarize();
    }
    overlay.style.display = 'flex';
    setTimeout(function() { if (nameInput) nameInput.focus(); }, 30);
}
function scCloseCommitModal() {
    const o = document.getElementById('commit-modal-overlay');
    if (o) o.style.display = 'none';
}

// Commit execution ---------------------------------------------------
async function scPerformCommit() {
    if (!ChangeQueue.length || scCommitting) return;
    scCloseCommitModal();
    scCommitting = true;
    scShowCommittingOverlay(true);
    scUpdateToolbar();
    scUpdateSidebarCommit();
    const total = ChangeQueue.length;
    const nameInput = document.getElementById('commit-modal-name');
    const customName = nameInput ? nameInput.value.trim() : '';
    const message = 'Browser: ' + (customName || ChangeQueue.summarize());
    try {
        const result = await ghBatchCommit({
            message: message,
            changes: ChangeQueue.toBatchChanges(),
            branch:  'main'
        });
        ChangeQueue.clear();
        scCommitting = false;
        scShowCommittingOverlay(false);
        if (result.retried) console.info('Show Changes: commit retried once after a race.');
        // Notify other tools (Image Manager, Blog List, …) so they can
        // refresh their server-state caches from the new commit.
        ChangeQueue.notifyCommitSuccess(result);
        scUpdateToolbar();
        scUpdateSidebarCommit();
    } catch (err) {
        scCommitting = false;
        scShowCommittingOverlay(false);
        scUpdateToolbar();
        scUpdateSidebarCommit();
        scShowConflictModal(err, total);
    }
}

function scShowCommittingOverlay(show) {
    const el = document.getElementById('show-changes-committing');
    if (el) el.style.display = show ? 'flex' : 'none';
}

// Conflict modal ----------------------------------------------------
function scShowConflictModal(err, total) {
    const overlay = document.getElementById('commit-conflict-modal-overlay');
    if (!overlay) return;
    document.getElementById('commit-conflict-action').textContent = 'Batch commit';
    document.getElementById('commit-conflict-path').textContent = '(' + total + ' staged changes)';
    document.getElementById('commit-conflict-message').textContent = err.message || String(err);
    const progress = document.getElementById('commit-conflict-progress');
    if (progress) {
        progress.innerHTML = '<strong>No changes were committed</strong> — the whole batch was rolled back atomically. Reset to drop the queue and re-fetch, or keep the queue and try Commit again once the conflicting file has settled.';
    }
    overlay.style.display = 'flex';
}
function scHideConflictModal() {
    const o = document.getElementById('commit-conflict-modal-overlay');
    if (o) o.style.display = 'none';
}

// Right-click "Remove from queue" -----------------------------------
function scShowContextMenu(e, index) {
    e.preventDefault();
    scHideContextMenu();
    const menu = document.createElement('div');
    menu.className = 'admin-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top  = e.clientY + 'px';
    const item = document.createElement('div');
    item.className = 'admin-context-menu-item';
    item.textContent = 'Remove from queue';
    item.addEventListener('click', function() {
        scHideContextMenu();
        ChangeQueue.removeAt(index);
    });
    menu.appendChild(item);
    document.body.appendChild(menu);
    scCtxMenuEl = menu;
    const rect = menu.getBoundingClientRect();
    if (rect.right  > window.innerWidth)  menu.style.left = (window.innerWidth  - rect.width  - 4) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top  = (window.innerHeight - rect.height - 4) + 'px';
}
function scHideContextMenu() {
    if (scCtxMenuEl) { scCtxMenuEl.remove(); scCtxMenuEl = null; }
}

// Bootstrap ---------------------------------------------------------
// bindClick provided by tools/js/admin-utils.js.

function scInit() {
    if (document.body.dataset.pageRole !== 'admin') return;

    AdminToolManager.register({
        id:      'show-changes',
        label:   '👁 Show Changes',
        panelId: 'show-changes-panel',
        order:   10,
        onOpen:  scRender
    });

    ChangeQueue.subscribe(scRender);

    bindClick('show-changes-close',  function() { AdminToolManager.close('show-changes'); });
    bindClick('show-changes-undo',   scUndo);
    bindClick('show-changes-reset',  scReset);
    bindClick('show-changes-commit', scCommitFromUser);
    bindClick('btn-commit',          scCommitFromUser);

    const body = document.getElementById('show-changes-body');
    if (body) body.addEventListener('contextmenu', function(e) {
        const item = e.target.closest('.show-changes-item');
        if (!item) return;
        const i = parseInt(item.dataset.i, 10);
        if (!isNaN(i)) scShowContextMenu(e, i);
    });

    bindClick('commit-modal-cancel',  scCloseCommitModal);
    bindClick('commit-modal-confirm', scPerformCommit);
    const commitOverlay = document.getElementById('commit-modal-overlay');
    if (commitOverlay) commitOverlay.addEventListener('click', function(e) {
        if (e.target === commitOverlay) scCloseCommitModal();
    });

    bindClick('commit-conflict-keep',  scHideConflictModal);
    bindClick('commit-conflict-reset', function() { scHideConflictModal(); scReset(); });
    const conflictOverlay = document.getElementById('commit-conflict-modal-overlay');
    if (conflictOverlay) conflictOverlay.addEventListener('click', function(e) {
        if (e.target === conflictOverlay) scHideConflictModal();
    });

    document.addEventListener('click', function(e) {
        if (scCtxMenuEl && !scCtxMenuEl.contains(e.target)) scHideContextMenu();
    });
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Escape') return;
        scHideContextMenu();
        scCloseCommitModal();
        scHideConflictModal();
    });

    scUpdateSidebarCommit();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scInit);
} else {
    scInit();
}
