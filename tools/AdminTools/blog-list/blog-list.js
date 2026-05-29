/* Blog List — admin tool.
   Lists the HTML files in Announcements-Blogs/ on the configured branch.
   Right-click a row →
     • Edit blog: fetches the HTML (or staged pending publishHtml) + matching
       JSON entry, parses it back into the editor's block model, and calls
       applySaveData() so the admin can edit and republish under the same
       filename (publish-blog's overwrite-confirm modal handles the rest).
     • Delete blog: stages `unpublishHtml` + updates the bundled
       `updateBlogIndex` JSON change. Undo restores both.

   Loaded on tools/post-generator-admin.html after admin-tool-manager.js,
   change-queue.js, AuthManager/github-api.js, and post-gen.js (escHtml,
   applySaveData, state, PLACEHOLDER_IMG). */

let blLoaded = false;
let blLoading = false;
let blItems = [];                  // last-fetched list, keyed by path on right-click
let blCtxMenuEl = null;
let blPendingDelete = null;        // {name, path, sha} awaiting delete-modal confirm
let blPendingEdit = null;          // {name, path, sha} awaiting edit-modal confirm

const BL_RESERVED_NAMES = ['index.html', 'base-template.html'];
// BLOG_DATA_PATH, decodeBase64Utf8, findEntryByHref, fetchBlogDataJson —
// provided by tools/js/admin-utils.js.

async function blFetchBlogs() {
    const items = await ghFetch('GET', '/contents/Announcements-Blogs');
    if (!Array.isArray(items)) return [];
    return items
        .filter(function(it) {
            if (it.type !== 'file') return false;
            if (!/\.html?$/i.test(it.name)) return false;
            if (BL_RESERVED_NAMES.indexOf(it.name.toLowerCase()) !== -1) return false;
            return true;
        })
        .map(function(it) { return { name: it.name, path: it.path, size: it.size, sha: it.sha }; })
        .sort(function(a, b) { return a.name.localeCompare(b.name); });
}

function blPendingDeletePaths() {
    const paths = new Set();
    ChangeQueue.list().forEach(function(a) {
        if (a.type === 'unpublishHtml') paths.add(a.path);
    });
    return paths;
}

function blRender() {
    const body = document.getElementById('blog-list-body');
    if (!body) return;
    if (!blItems || !blItems.length) {
        body.innerHTML = '<div class="blog-list-placeholder">No HTML files in Announcements-Blogs/.</div>';
        return;
    }
    const pending = blPendingDeletePaths();
    body.innerHTML = '<ul class="blog-list-files">'
        + blItems.map(function(it) {
            const isPending = pending.has(it.path);
            const cls = 'blog-list-item' + (isPending ? ' blog-list-item-pending' : '');
            const tag = isPending ? '<span class="blog-list-tag">−PENDING DELETE</span>' : '';
            return '<li class="' + cls + '" data-path="' + escHtml(it.path) + '" title="' + escHtml(it.path) + '">'
                 + '<span class="blog-list-icon">📄</span>'
                 + '<span class="blog-list-name">' + escHtml(it.name) + '</span>'
                 + tag
                 + '</li>';
        }).join('')
        + '</ul>';
}

async function blLoadAndRender() {
    const body = document.getElementById('blog-list-body');
    if (!body || blLoading) return;
    blLoading = true;
    body.innerHTML = '<div class="blog-list-placeholder">Loading…</div>';
    try {
        blItems = await blFetchBlogs();
        blLoaded = true;
        blRender();
    } catch (err) {
        body.innerHTML = '<div class="blog-list-placeholder blog-list-error">'
                       + escHtml(err.message || String(err))
                       + '<br><br><button class="admin-tool-btn" id="bl-retry">Retry</button>'
                       + '</div>';
        const r = document.getElementById('bl-retry');
        if (r) r.addEventListener('click', function() { blLoaded = false; blLoadAndRender(); });
    } finally {
        blLoading = false;
    }
}

// Context menu --------------------------------------------------------
function blShowContextMenu(e, item) {
    e.preventDefault();
    blHideContextMenu();
    const menu = document.createElement('div');
    menu.className = 'admin-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top  = e.clientY + 'px';

    // Edit blog — load this post's HTML back into the builder for republish.
    // Disabled while the row has a pending unpublishHtml in the queue: editing
    // a blog already staged for deletion just creates confusion.
    const isPendingDelete = blPendingDeletePaths().has(item.path);
    const edit = document.createElement('div');
    edit.className = 'admin-context-menu-item' + (isPendingDelete ? ' admin-context-menu-item-disabled' : '');
    edit.textContent = 'Edit blog';
    if (isPendingDelete) edit.title = 'Undo the pending delete first';
    if (!isPendingDelete) {
        edit.addEventListener('click', function() {
            blHideContextMenu();
            blRequestEdit(item);
        });
    }
    menu.appendChild(edit);

    const del = document.createElement('div');
    del.className = 'admin-context-menu-item';
    del.textContent = 'Delete blog';
    del.addEventListener('click', function() {
        blHideContextMenu();
        blRequestDelete(item);
    });
    menu.appendChild(del);

    document.body.appendChild(menu);
    blCtxMenuEl = menu;
    const rect = menu.getBoundingClientRect();
    if (rect.right  > window.innerWidth)  menu.style.left = (window.innerWidth  - rect.width  - 4) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top  = (window.innerHeight - rect.height - 4) + 'px';
}

function blHideContextMenu() {
    if (blCtxMenuEl) { blCtxMenuEl.remove(); blCtxMenuEl = null; }
}

// Delete confirmation modal ------------------------------------------
function blRequestDelete(item) {
    blPendingDelete = item;
    const overlay = document.getElementById('blog-delete-modal-overlay');
    if (!overlay) return;
    const body = document.getElementById('blog-delete-body');
    if (body) body.innerHTML =
        'Queues deletion of <code>' + escHtml(item.path) + '</code> '
      + 'and removes the matching entry from <code>' + BLOG_DATA_PATH + '</code>. '
      + 'Both changes commit together when you Commit.';
    overlay.style.display = 'flex';
}

function blCloseDeleteModal() {
    const o = document.getElementById('blog-delete-modal-overlay');
    if (o) o.style.display = 'none';
    blPendingDelete = null;
}

async function blConfirmDelete() {
    if (!blPendingDelete) return;
    const item = blPendingDelete;
    blCloseDeleteModal();
    try {
        await blStageDelete(item);
    } catch (err) {
        alert('Failed to stage delete: ' + (err.message || err));
    }
}

// Stage the delete: fetch JSON (or use pending), find entry, queue actions.
async function blStageDelete(item) {
    const currentJson = await fetchBlogDataJson();

    // Find the entry by href (== item.path) across both arrays
    let originalEntry = null;
    let originalTarget = null;
    const found = findEntryByHref(currentJson, item.path);
    if (found) {
        originalEntry  = found.entry;
        originalTarget = found.array;
        currentJson[found.array].splice(found.index, 1);
    }

    // If a prior pending publishHtml exists for this path, chain its originalEntry
    // so undoing this delete restores the TRUE server entry, not the staged one.
    const priorPub = ChangeQueue.list().find(function(a) {
        return a.type === 'publishHtml' && a.path === item.path;
    });
    if (priorPub && priorPub.originalEntry) {
        originalEntry  = priorPub.originalEntry;
        originalTarget = priorPub.originalTarget;
    }

    // Queue (or replace) the unpublishHtml action for this path
    ChangeQueue.replaceOrAdd(
        function(a) { return a.type === 'unpublishHtml' && a.path === item.path; },
        {
            type:           'unpublishHtml',
            path:           item.path,
            sha:            item.sha,            // informational; tree-based delete doesn't require it
            originalEntry:  originalEntry,
            originalTarget: originalTarget
        }
    );

    // Update or add the bundled JSON index change
    const newContent = JSON.stringify(currentJson, null, 4);
    ChangeQueue.replaceOrAdd(
        function(a) { return a.type === 'updateBlogIndex'; },
        {
            type:    'updateBlogIndex',
            path:    BLOG_DATA_PATH,
            content: newContent
        }
    );

    if (typeof AdminToolManager !== 'undefined') AdminToolManager.open('show-changes');
}

// Edit flow ----------------------------------------------------------
function blRequestEdit(item) {
    blPendingEdit = item;
    // Empty-builder fast path: no warning needed, just load.
    if (blBuilderIsEmpty()) { blConfirmEdit(); return; }
    const overlay = document.getElementById('blog-edit-modal-overlay');
    if (!overlay) return;
    const nameEl = document.getElementById('blog-edit-name');
    if (nameEl) nameEl.textContent = item.path;
    overlay.style.display = 'flex';
}

function blCloseEditModal() {
    const o = document.getElementById('blog-edit-modal-overlay');
    if (o) o.style.display = 'none';
    blPendingEdit = null;
}

async function blConfirmEdit() {
    if (!blPendingEdit) return;
    const item = blPendingEdit;
    blCloseEditModal();
    try {
        await blLoadAndPopulate(item);
    } catch (err) {
        alert('Failed to load blog: ' + (err.message || err));
    }
}

function blBuilderIsEmpty() {
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

async function blLoadAndPopulate(item) {
    if (typeof applySaveData !== 'function') {
        alert('Editor not ready — refresh and try again.');
        return;
    }

    // Resolve the JSON entry. Prefer a pending updateBlogIndex (admin's
    // staged-but-uncommitted state) over the server file.
    const jsonObj = await fetchBlogDataJson();
    const found = findEntryByHref(jsonObj, item.path);
    const jsonEntry = found ? found.entry : null;

    // Resolve the HTML. Prefer a pending publishHtml at this path so the admin
    // edits their own staged-but-uncommitted version, not the older server file.
    const priorPub = ChangeQueue.list().find(function(a) {
        return a.type === 'publishHtml' && a.path === item.path;
    });
    let htmlString;
    if (priorPub) {
        htmlString = priorPub.content;
    } else {
        const resp = await ghFetch('GET', '/contents/' + item.path);
        htmlString = decodeBase64Utf8(resp.content);
    }

    const saveData = blParseHtmlToSaveData(htmlString, jsonEntry, item.name);

    // Clear lingering form-field values applySaveData wouldn't touch (it only
    // sets fields whose values in data.fields are truthy). Without this, e.g.
    // a non-event blog loaded over an event-in-progress would leave the old
    // end-date populated.
    ['f-title', 'f-author', 'f-thumbnail', 'f-end-date', 'f-filename'].forEach(function(id) {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });

    applySaveData(saveData);

    if (typeof AdminToolManager !== 'undefined') AdminToolManager.close('blog-list');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// HTML → applySaveData() shape ---------------------------------------
function blParseHtmlToSaveData(htmlString, jsonEntry, filename) {
    const doc = new DOMParser().parseFromString(htmlString, 'text/html');

    const sidebar = doc.querySelector('.blog-sidebar');
    const showContributors = !!sidebar;
    const body = doc.querySelector('.blog-body');

    const blocks = body ? blParseBlocks(body) : [];
    const contributors = sidebar ? blParseContributors(sidebar) : [];

    // Author lives in HTML only — landmark is the second .blog-meta-value
    // inside .blog-header (see Announcements-Blogs/base-template.html:32).
    const authorEl = doc.querySelector('.blog-header .blog-meta-row:nth-of-type(2) .blog-meta-value');
    const author = authorEl ? (authorEl.textContent || '').trim() : '';

    const isEvent = !!(jsonEntry && jsonEntry.end_date);
    const hasSlideshowCss = blocks.some(function(b) { return b.type === 'slideshow'; });

    // Filename input does NOT carry the extension — getFilename() re-appends it.
    const filenameBase = (filename || '').replace(/\.html?$/i, '');

    return {
        templateId: 'blank',
        settings: { isEvent: isEvent, hasSlideshowCss: hasSlideshowCss, showContributors: showContributors },
        blocks: blocks,
        contributors: contributors,
        showContributors: showContributors,
        fields: {
            title:     (jsonEntry && jsonEntry.title) || '',
            author:    author,
            date:      blJsonDateToInputDate(jsonEntry && jsonEntry.date),
            endDate:   blJsonDateToInputDate(jsonEntry && jsonEntry.end_date),
            thumbnail: (jsonEntry && jsonEntry.thumbnail) || '',
            filename:  filenameBase
        }
    };
}

function blParseBlocks(container) {
    const out = [];
    Array.from(container.children).forEach(function(el) {
        if (el.matches('.blog-two-col')) {
            // Each .blog-row holds one A-column and one B-column cell. Walk
            // them in source order so block ordering survives the round-trip.
            Array.from(el.querySelectorAll(':scope > .blog-row')).forEach(function(row) {
                const textCol = row.querySelector(':scope > .blog-row-text');
                const mediaCol = row.querySelector(':scope > .blog-row-media');
                if (textCol) Array.from(textCol.children).forEach(function(c) {
                    const b = blParseSingleBlock(c);
                    if (b) { b.col = 'A'; out.push(b); }
                });
                if (mediaCol) Array.from(mediaCol.children).forEach(function(c) {
                    const b = blParseSingleBlock(c);
                    if (b) { b.col = 'B'; out.push(b); }
                });
            });
            return;
        }
        const b = blParseSingleBlock(el);
        if (b) out.push(b);
    });
    return out;
}

function blParseSingleBlock(el) {
    if (el.matches('p')) {
        return { type: 'paragraph', text: el.textContent || '' };
    }
    if (el.matches('h2.blog-section-heading')) {
        return { type: 'section-heading', text: el.textContent || '' };
    }
    if (el.matches('hr.blog-divider')) {
        return { type: 'divider' };
    }
    if (el.matches('figure.blog-figure')) {
        const img = el.querySelector('img');
        const cap = el.querySelector('figcaption');
        return {
            type: 'image',
            url:     blStripDotDot(img ? img.getAttribute('src') : ''),
            alt:     img ? (img.getAttribute('alt') || '') : '',
            caption: cap ? (cap.textContent || '').trim() : ''
        };
    }
    if (el.matches('div.blog-video')) {
        const iframe = el.querySelector('iframe');
        const src = iframe ? (iframe.getAttribute('src') || '') : '';
        return { type: 'youtube-inline', url: blWatchUrlFromEmbed(src) };
    }
    if (el.matches('div.blog-slideshow')) {
        const slides = Array.from(el.querySelectorAll('img.slideshow-slide')).map(function(img) {
            return {
                url: blStripDotDot(img.getAttribute('src') || ''),
                alt: img.getAttribute('alt') || ''
            };
        });
        return { type: 'slideshow', slides: slides.length ? slides : [{ url: '', alt: '' }] };
    }
    console.warn('blog-list edit: skipped unrecognized element', el);
    return null;
}

function blParseContributors(sidebar) {
    return Array.from(sidebar.querySelectorAll('.contributor-card')).map(function(card) {
        const nameEl = card.querySelector('.contributor-name');
        const photoImg = card.querySelector('.contributor-photo img');
        const socialAnchors = Array.from(card.querySelectorAll('.contributor-social'));
        return {
            name: nameEl ? (nameEl.textContent || '').trim() : '',
            photo: blStripDotDot(photoImg ? (photoImg.getAttribute('src') || '') : ''),
            socials: socialAnchors.map(function(a) {
                const use = a.querySelector('use');
                const href = use ? (use.getAttribute('href') || use.getAttribute('xlink:href') || '') : '';
                const m = href.match(/#icon-([a-z0-9-]+)/i);
                return {
                    platform: m ? m[1] : 'other',
                    url: a.getAttribute('href') || ''
                };
            })
        };
    });
}

// Strip the "../" prefix that toBodyHtml adds to every src. Treat the
// placeholder path as an empty input (matches what the editor shows when
// no path is typed).
function blStripDotDot(src) {
    if (!src) return '';
    const s = src.replace(/^\.\.\//, '');
    if (typeof PLACEHOLDER_IMG !== 'undefined' && s === PLACEHOLDER_IMG) return '';
    return s;
}

// embed/<id> → watch?v=<id>. The editor's extractYouTubeId handles either form
// so this is just for the field's UX (the admin sees the input they originally
// pasted, not the embed URL).
function blWatchUrlFromEmbed(src) {
    const m = (src || '').match(/embed\/([^/?#]+)/);
    return m ? ('https://www.youtube.com/watch?v=' + m[1]) : (src || '');
}

// blog-data.json stores "MM-DD-YYYY"; HTML <input type="date"> wants "YYYY-MM-DD".
function blJsonDateToInputDate(s) {
    if (!s) return '';
    const m = s.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    return m ? (m[3] + '-' + m[1] + '-' + m[2]) : s;
}

// Bootstrap ----------------------------------------------------------
function blInit() {
    if (document.body.dataset.pageRole !== 'admin') return;

    AdminToolManager.register({
        id:      'blog-list',
        label:   '📄 Display Blog Files',
        panelId: 'blog-list-panel',
        order:   30,
        onOpen:  function() { if (!blLoaded) blLoadAndRender(); else blRender(); }
    });

    // Re-render rows whenever the queue changes (so pending-delete tags update).
    ChangeQueue.subscribe(blRender);

    // After a successful commit, the server file list is stale — drop it so
    // the next open re-fetches. Re-fetch immediately if the panel is loaded.
    ChangeQueue.onCommitSuccess(function() {
        if (blLoaded) {
            blLoaded = false;
            blLoadAndRender();
        }
    });

    const close = document.getElementById('blog-list-close');
    if (close) close.addEventListener('click', function() { AdminToolManager.close('blog-list'); });

    const reload = document.getElementById('blog-list-reload');
    if (reload) reload.addEventListener('click', function() {
        if (blLoading) return;
        blLoaded = false;
        blLoadAndRender();
    });

    const body = document.getElementById('blog-list-body');
    if (body) body.addEventListener('contextmenu', function(e) {
        const row = e.target.closest('.blog-list-item');
        if (!row || !row.dataset.path) return;
        const item = blItems.find(function(x) { return x.path === row.dataset.path; });
        if (item) blShowContextMenu(e, item);
    });

    // Delete-modal wiring
    const dOverlay = document.getElementById('blog-delete-modal-overlay');
    if (dOverlay) dOverlay.addEventListener('click', function(e) {
        if (e.target === dOverlay) blCloseDeleteModal();
    });
    const dCancel = document.getElementById('blog-delete-cancel');
    if (dCancel) dCancel.addEventListener('click', blCloseDeleteModal);
    const dConfirm = document.getElementById('blog-delete-confirm');
    if (dConfirm) dConfirm.addEventListener('click', blConfirmDelete);

    // Edit-modal wiring
    const eOverlay = document.getElementById('blog-edit-modal-overlay');
    if (eOverlay) eOverlay.addEventListener('click', function(e) {
        if (e.target === eOverlay) blCloseEditModal();
    });
    const eCancel = document.getElementById('blog-edit-cancel');
    if (eCancel) eCancel.addEventListener('click', blCloseEditModal);
    const eConfirm = document.getElementById('blog-edit-confirm');
    if (eConfirm) eConfirm.addEventListener('click', blConfirmEdit);

    document.addEventListener('click', function(e) {
        if (blCtxMenuEl && !blCtxMenuEl.contains(e.target)) blHideContextMenu();
    });
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Escape') return;
        blHideContextMenu();
        blCloseDeleteModal();
        blCloseEditModal();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', blInit);
} else {
    blInit();
}
