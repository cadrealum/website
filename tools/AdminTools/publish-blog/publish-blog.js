/* Publish Blog — admin-only feature.
   Renames the existing "Generate Post HTML" button to "📤 Publish Blog" on the
   admin page and adds a click handler that opens a popup asking
   Announcement vs Event. On choice, stages two ChangeQueue actions:

       publishHtml      → PUT Announcements-Blogs/<filename>.html
       updateBlogIndex  → PUT json/blog-data.json with the new entry appended
                          to the chosen array

   Multiple publishes before committing stack: each adds a publishHtml and
   replaces the singleton updateBlogIndex with one that contains the running
   set of new entries. */

// BLOG_DATA_PATH, decodeBase64Utf8, findEntryByHref, fetchBlogDataJson,
// bindClick — provided by tools/js/admin-utils.js (loaded earlier).

// ── Inline filename-collision warning ─────────────────────────────────
// Lightweight cache of the server's blog-data.json, populated the first time
// the user types in the filename input (and refreshed after every successful
// commit). On every keystroke we check getFilename() against the cache and
// flash an amber chip if it collides — so the user knows BEFORE clicking
// Publish that they're about to overwrite something.

let pbServerIndexCache = null;          // parsed blog-data.json from the server
let pbServerIndexFetching = false;      // single-flight guard
let pbCollisionChipEl = null;           // inserted next to #f-filename

function pbEnsureCollisionChip() {
    if (pbCollisionChipEl) return pbCollisionChipEl;
    const fn = document.getElementById('f-filename');
    const headerFilename = fn && fn.closest('.header-filename');
    if (!headerFilename) return null;
    const chip = document.createElement('span');
    chip.id = 'publish-collision-chip';
    chip.className = 'publish-collision-chip';
    chip.style.display = 'none';
    headerFilename.appendChild(chip);
    pbCollisionChipEl = chip;
    return chip;
}

async function pbEnsureServerIndexCache() {
    if (pbServerIndexCache || pbServerIndexFetching) return pbServerIndexCache;
    pbServerIndexFetching = true;
    try {
        // Always fetch the server's copy — never the staged in-flight one —
        // because the chip's job is to warn about COMMITTED state.
        const resp = await ghFetch('GET', '/contents/' + BLOG_DATA_PATH);
        pbServerIndexCache = JSON.parse(decodeBase64Utf8(resp.content));
    } catch (err) {
        console.warn('Publish: collision-warning cache fetch failed', err);
    } finally {
        pbServerIndexFetching = false;
    }
    return pbServerIndexCache;
}

function pbUpdateCollisionChip() {
    const chip = pbEnsureCollisionChip();
    if (!chip) return;
    if (!pbServerIndexCache) {
        chip.style.display = 'none';
        return;
    }
    if (typeof getFilename !== 'function') return;
    const filename = getFilename();
    const href = 'Announcements-Blogs/' + filename;
    const found = findEntryByHref(pbServerIndexCache, href);
    if (!found) {
        chip.style.display = 'none';
        return;
    }
    const label = found.array === 'events' ? 'Events' : 'Announcements';
    chip.textContent = '⚠ overwrites existing post (' + label + ')';
    chip.title = 'A post already lives at ' + href + ' (in ' + label + '). Publishing will overwrite its HTML and update its JSON entry.';
    chip.style.display = '';
}

function pbInitCollisionWarning() {
    const fn = document.getElementById('f-filename');
    const title = document.getElementById('f-title');
    if (!fn) return;

    let debounceId = null;
    function schedule() {
        clearTimeout(debounceId);
        debounceId = setTimeout(function() {
            pbEnsureServerIndexCache().then(pbUpdateCollisionChip);
        }, 250);
    }
    fn.addEventListener('input', schedule);
    if (title) title.addEventListener('input', schedule);

    // Refresh cache after every successful commit so the chip reflects the
    // new server state.
    if (typeof ChangeQueue !== 'undefined' && ChangeQueue.onCommitSuccess) {
        ChangeQueue.onCommitSuccess(function() {
            pbServerIndexCache = null;
            pbEnsureServerIndexCache().then(pbUpdateCollisionChip);
        });
    }
}

function pbUpdateButtonState() {
    const btn = document.getElementById('btn-generate');
    if (!btn) return;
    const builder = document.getElementById('content-builder');
    const hasBlocks = !!builder && !!builder.querySelector('.block-item');
    btn.disabled = !hasBlocks;
}

function pbInit() {
    if (document.body.dataset.pageRole !== 'admin') return;

    // Rename the button AND replace post-gen.js's listener with ours.
    // Cloning the node strips every listener attached via addEventListener,
    // so the legacy "fill the output textareas + scroll" behaviour is gone
    // on the admin page. The button now only opens the publish modal.
    const oldBtn = document.getElementById('btn-generate');
    if (oldBtn && oldBtn.parentNode) {
        const newBtn = oldBtn.cloneNode(false);
        newBtn.textContent = '📤 Publish Blog';
        oldBtn.parentNode.replaceChild(newBtn, oldBtn);
        newBtn.addEventListener('click', pbOpenModal);
    }

    // Disable Publish Blog whenever the content builder has no blocks.
    // post-gen.js mutates #content-builder's children via innerHTML when blocks
    // are added/removed/loaded, so a childList MutationObserver catches every
    // state change cleanly.
    const builder = document.getElementById('content-builder');
    if (builder) {
        const obs = new MutationObserver(pbUpdateButtonState);
        obs.observe(builder, { childList: true, subtree: false });
    }
    pbUpdateButtonState();

    bindClick('publish-modal-cancel',   pbCloseModal);
    bindClick('publish-modal-announce', function() { pbDoPublish('announcements'); });
    bindClick('publish-modal-event',    function() { pbDoPublish('events'); });

    const overlay = document.getElementById('publish-modal-overlay');
    if (overlay) overlay.addEventListener('click', function(e) {
        if (e.target === overlay) pbCloseModal();
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') pbCloseModal();
    });

    pbInitCollisionWarning();
}

// Lint the in-progress post and return a list of human-readable issues.
// Doesn't block publish — defaults exist for every field — but surfaces gaps
// the user can fix BEFORE committing.
function pbCollectValidationIssues() {
    const issues = [];
    if (typeof state === 'undefined') return issues;

    const get = function(id) { const el = document.getElementById(id); return el ? (el.value || '').trim() : ''; };

    if (!get('f-title'))     issues.push('Title is empty.');
    if (!get('f-author'))    issues.push('Author is empty.');
    if (!get('f-date'))      issues.push('Date is empty.');
    if (!get('f-thumbnail')) issues.push('Thumbnail image is empty — the listing card will show a placeholder.');

    if (state.settings && state.settings.isEvent && !get('f-end-date')) {
        issues.push('End-date is empty for an event template.');
    }

    const blocks = state.blocks || [];
    const missingImages = blocks.filter(function(b) {
        return b.type === 'image' && !(b.url && b.url.trim());
    }).length;
    if (missingImages) {
        issues.push(missingImages + ' image block' + (missingImages === 1 ? '' : 's') + ' missing an image path.');
    }
    const missingSlides = blocks.reduce(function(n, b) {
        if (b.type !== 'slideshow') return n;
        return n + (b.slides || []).filter(function(s) { return !(s.url && s.url.trim()); }).length;
    }, 0);
    if (missingSlides) {
        issues.push(missingSlides + ' slideshow slide' + (missingSlides === 1 ? '' : 's') + ' missing an image path.');
    }

    if (state.showContributors) {
        const namelessContribs = (state.contributors || []).filter(function(c) {
            return !(c.name && c.name.trim());
        }).length;
        if (namelessContribs) {
            issues.push(namelessContribs + ' contributor' + (namelessContribs === 1 ? '' : 's') + ' missing a name.');
        }
    }

    return issues;
}

function pbRenderValidationBlock(issues) {
    const slot = document.getElementById('publish-modal-validation');
    if (!slot) return;
    if (!issues.length) { slot.style.display = 'none'; slot.innerHTML = ''; return; }
    slot.style.display = '';
    slot.innerHTML = '<p class="publish-modal-validation-title">Before you publish:</p><ul>'
        + issues.map(function(i) { return '<li>' + escHtml(i) + '</li>'; }).join('')
        + '</ul>'
        + '<p class="publish-modal-validation-help">You can still publish — these are warnings, not errors.</p>';
}

function pbOpenModal() {
    // post-gen.js's handler used to do these — we replaced its listener so we
    // own the validation + DOM-sync now.
    if (typeof state === 'undefined' || !state.templateId) {
        alert('Please choose a template first.');
        return;
    }
    if (typeof syncBlocksFromDOM === 'function')      syncBlocksFromDOM();
    if (typeof syncContributorsFromDOM === 'function') syncContributorsFromDOM();

    if (typeof getFilename !== 'function') return;
    const filename = getFilename();
    if (!filename) {
        alert('Please enter a filename before publishing.');
        return;
    }
    // Reserved filenames in Announcements-Blogs/ that must never be overwritten.
    const reserved = ['index.html', 'base-template.html'];
    if (reserved.indexOf(filename.toLowerCase()) !== -1) {
        alert('"' + filename + '" is reserved by the site (index / base template). Please choose a different filename.');
        return;
    }
    const fnEl = document.getElementById('publish-modal-filename');
    if (fnEl) fnEl.textContent = filename;

    pbRenderValidationBlock(pbCollectValidationIssues());

    // Default the primary button to Event when an end-date is filled —
    // matches Phase 3.5 (auto-detect event vs announcement).
    const eventBtn = document.getElementById('publish-modal-event');
    const announceBtn = document.getElementById('publish-modal-announce');
    const isEventish = !!(document.getElementById('f-end-date') && document.getElementById('f-end-date').value);
    if (eventBtn && announceBtn) {
        eventBtn.classList.toggle('publish-modal-default', isEventish);
        announceBtn.classList.toggle('publish-modal-default', !isEventish);
    }

    const overlay = document.getElementById('publish-modal-overlay');
    if (overlay) overlay.style.display = 'flex';
}

function pbCloseModal() {
    const overlay = document.getElementById('publish-modal-overlay');
    if (overlay) overlay.style.display = 'none';
}

async function pbDoPublish(target /* 'announcements' | 'events' */) {
    pbCloseModal();

    if (typeof buildFullHTML !== 'function' || typeof buildJSONEntry !== 'function') {
        alert('Build functions unavailable — refresh the page.');
        return;
    }

    // Build HTML
    const html = buildFullHTML();
    if (!html) return;  // build alerted already

    // Build & parse the JSON entry (post-gen-output emits a string with trailing comma)
    const entryStr = buildJSONEntry().trim();
    const clean = entryStr.endsWith(',') ? entryStr.slice(0, -1) : entryStr;
    let entry;
    try { entry = JSON.parse(clean); }
    catch (err) { alert('Failed to parse generated JSON entry: ' + err.message); return; }

    const filename = getFilename();
    const htmlPath = 'Announcements-Blogs/' + filename;

    // Fetch (or reuse pending) blog-data.json content
    let currentJson;
    try {
        currentJson = await fetchBlogDataJson();
    } catch (err) {
        alert('Failed to load ' + BLOG_DATA_PATH + ' from GitHub:\n' + (err.message || err));
        return;
    }

    // Collision check — does an entry already exist at this href (either on
    // the server or staged from an earlier publish this session)?
    const existing = findEntryByHref(currentJson, htmlPath);
    let originalEntry  = null;
    let originalTarget = null;

    if (existing) {
        const ok = await pbConfirmOverwrite(existing, target, htmlPath);
        if (!ok) return;

        // Chain through any prior pending publishHtml for the same path so
        // the TRUE server-original entry is preserved across multiple overwrites.
        const priorPub = ChangeQueue.list().find(function(a) {
            return a.type === 'publishHtml' && a.path === htmlPath;
        });
        if (priorPub) {
            originalEntry  = priorPub.originalEntry;
            originalTarget = priorPub.originalTarget;
        } else {
            originalEntry  = existing.entry;
            originalTarget = existing.array;
        }

        // Remove the existing entry from its current array (could be either array)
        currentJson[existing.array].splice(existing.index, 1);
    }

    // Add the new entry to the chosen target array
    if (!Array.isArray(currentJson[target])) currentJson[target] = [];
    currentJson[target].push(entry);

    const newJsonContent = JSON.stringify(currentJson, null, 4);

    // Queue/replace the publishHtml action (replaceOrAdd dedups when the user
    // re-publishes the same filename without committing in between)
    ChangeQueue.replaceOrAdd(
        function(a) { return a.type === 'publishHtml' && a.path === htmlPath; },
        {
            type:           'publishHtml',
            path:           htmlPath,
            content:        html,
            target:         target,
            entry:          entry,
            originalEntry:  originalEntry,
            originalTarget: originalTarget
        }
    );

    ChangeQueue.replaceOrAdd(
        function(a) { return a.type === 'updateBlogIndex'; },
        {
            type:    'updateBlogIndex',
            path:    BLOG_DATA_PATH,
            content: newJsonContent
        }
    );

    // Open Show Changes so the user can see what just got staged
    if (typeof AdminToolManager !== 'undefined') AdminToolManager.open('show-changes');
}

function pbConfirmOverwrite(existing, newTarget, htmlPath) {
    return new Promise(function(resolve) {
        const overlay = document.getElementById('publish-overwrite-modal-overlay');
        if (!overlay) { resolve(false); return; }

        document.getElementById('publish-overwrite-path').textContent          = htmlPath;
        document.getElementById('publish-overwrite-existing-title').textContent = existing.entry.title || '(no title)';
        document.getElementById('publish-overwrite-existing-date').textContent  = existing.entry.date  || '(no date)';
        document.getElementById('publish-overwrite-existing-array').textContent = existing.array;
        document.getElementById('publish-overwrite-new-array').textContent      = newTarget;

        const confirmBtn = document.getElementById('publish-overwrite-confirm');
        const cancelBtn  = document.getElementById('publish-overwrite-cancel');

        function cleanup() {
            confirmBtn.removeEventListener('click', onConfirm);
            cancelBtn.removeEventListener('click', onCancel);
            overlay.removeEventListener('click', onBackdrop);
            document.removeEventListener('keydown', onKey);
        }
        function onConfirm()  { cleanup(); overlay.style.display = 'none'; resolve(true); }
        function onCancel()   { cleanup(); overlay.style.display = 'none'; resolve(false); }
        function onBackdrop(e){ if (e.target === overlay) onCancel(); }
        function onKey(e)     { if (e.key === 'Escape') onCancel(); }

        confirmBtn.addEventListener('click', onConfirm);
        cancelBtn.addEventListener('click', onCancel);
        overlay.addEventListener('click', onBackdrop);
        document.addEventListener('keydown', onKey);
        overlay.style.display = 'flex';
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', pbInit);
} else {
    pbInit();
}
