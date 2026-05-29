/* Blog Index Check — admin tool.
   Cross-references json/blog-data.json against the actual HTML files in
   Announcements-Blogs/ to surface drift that the publish flow can't catch:

     • Orphan entries  — JSON entry's href points at a missing HTML file.
     • Unindexed posts — HTML file in Announcements-Blogs/ has no JSON entry.
     • Broken thumbs  — HEAD request to the thumbnail path returns 404.
     • Bad dates      — date or end_date doesn't match MM-DD-YYYY.

   Right-click any row → "Stage fix" queues the appropriate ChangeQueue
   action (deleteFile for orphans, updateBlogIndex for entry removal).

   Loaded on tools/post-generator-admin.html after change-queue.js and
   admin-utils.js. */

const BIC_RESERVED_NAMES = ['index.html', 'base-template.html'];

let bicLoaded   = false;
let bicLoading  = false;
let bicReport   = null;     // { orphans, unindexed, brokenThumbs, badDates }
let bicCtxMenuEl = null;

async function bicFetchHtmlFiles() {
    const items = await ghFetch('GET', '/contents/Announcements-Blogs');
    if (!Array.isArray(items)) return [];
    return items
        .filter(function(it) {
            return it.type === 'file'
                && /\.html?$/i.test(it.name)
                && BIC_RESERVED_NAMES.indexOf(it.name.toLowerCase()) === -1;
        })
        .map(function(it) { return { name: it.name, path: it.path, sha: it.sha }; });
}

function bicIsValidJsonDate(s) {
    return /^\d{2}-\d{2}-\d{4}$/.test(String(s || ''));
}

async function bicHeadOk(url) {
    try {
        const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        return r.ok;
    } catch (_) {
        return false;
    }
}

async function bicRunCheck() {
    const body = document.getElementById('blog-index-check-body');
    if (!body || bicLoading) return;
    bicLoading = true;
    body.innerHTML = '<div class="blog-index-check-placeholder">Checking…</div>';

    let json, files;
    try {
        json = await fetchBlogDataJson();
        files = await bicFetchHtmlFiles();
    } catch (err) {
        body.innerHTML = '<div class="blog-index-check-placeholder blog-index-check-error">'
                       + escHtml(err.message || String(err))
                       + '<br><br><button class="admin-tool-btn" id="bic-retry">Retry</button>'
                       + '</div>';
        bindClick('bic-retry', function() { bicLoaded = false; bicRunCheck(); });
        bicLoading = false;
        return;
    }

    const fileSet = new Set(files.map(function(f) { return f.path; }));
    const orphans = [];      // {entry, array, href}
    const badDates = [];     // {entry, array, reason}
    const allEntries = [];

    ['announcements', 'events'].forEach(function(arrName) {
        const arr = json[arrName];
        if (!Array.isArray(arr)) return;
        arr.forEach(function(e) {
            allEntries.push({ entry: e, array: arrName });
            if (e.href && !fileSet.has(e.href)) {
                orphans.push({ entry: e, array: arrName, href: e.href });
            }
            if (!bicIsValidJsonDate(e.date)) {
                badDates.push({ entry: e, array: arrName, reason: 'date "' + (e.date || '') + '" should be MM-DD-YYYY' });
            }
            if (e.end_date && !bicIsValidJsonDate(e.end_date)) {
                badDates.push({ entry: e, array: arrName, reason: 'end_date "' + e.end_date + '" should be MM-DD-YYYY' });
            }
        });
    });

    const indexedHrefs = new Set(allEntries.map(function(x) { return x.entry.href; }));
    const unindexed = files.filter(function(f) { return !indexedHrefs.has(f.path); });

    // HEAD-check thumbnails in parallel. Paths are repo-root relative so we
    // resolve them against the site root (where blog-data.json lives).
    const brokenThumbs = [];
    const thumbChecks = allEntries
        .filter(function(x) { return x.entry.thumbnail; })
        .map(async function(x) {
            const url = new URL('../' + x.entry.thumbnail, window.location.href).href;
            const ok = await bicHeadOk(url);
            if (!ok) brokenThumbs.push({ entry: x.entry, array: x.array, thumbnail: x.entry.thumbnail });
        });
    await Promise.all(thumbChecks);

    bicReport = { orphans: orphans, unindexed: unindexed, brokenThumbs: brokenThumbs, badDates: badDates };
    bicLoaded = true;
    bicLoading = false;
    bicRender();
}

function bicRender() {
    const body = document.getElementById('blog-index-check-body');
    if (!body) return;
    if (!bicReport) {
        body.innerHTML = '<div class="blog-index-check-placeholder">No report yet. Click ↻ to run.</div>';
        return;
    }

    const r = bicReport;
    const total = r.orphans.length + r.unindexed.length + r.brokenThumbs.length + r.badDates.length;

    if (total === 0) {
        body.innerHTML = '<div class="blog-index-check-placeholder blog-index-check-ok">'
                       + '✓ All clean — JSON, HTML files, thumbnails, and date formats look consistent.'
                       + '</div>';
        return;
    }

    let html = '<div class="blog-index-check-summary">'
             + 'Found <strong>' + total + '</strong> issue' + (total === 1 ? '' : 's') + '.'
             + ' Right-click an issue to stage a fix.'
             + '</div>';

    function section(title, items, renderRow) {
        if (!items.length) return '';
        let s = '<div class="blog-index-check-section">'
              + '<div class="blog-index-check-section-title">' + title + ' (' + items.length + ')</div>'
              + '<ul class="blog-index-check-list">';
        items.forEach(function(it, i) {
            s += renderRow(it, i);
        });
        s += '</ul></div>';
        return s;
    }

    html += section('Orphan entries', r.orphans, function(o, i) {
        return '<li class="blog-index-check-item" data-kind="orphan" data-i="' + i + '" title="' + escHtml(o.href) + '">'
             + '<span class="blog-index-check-tag tag-orphan">orphan</span>'
             + '<span class="blog-index-check-name">' + escHtml(o.entry.title || o.href) + '</span>'
             + '<span class="blog-index-check-detail">' + escHtml(o.array) + ' → ' + escHtml(o.href) + '</span>'
             + '</li>';
    });
    html += section('Unindexed HTML files', r.unindexed, function(u, i) {
        return '<li class="blog-index-check-item" data-kind="unindexed" data-i="' + i + '" title="' + escHtml(u.path) + '">'
             + '<span class="blog-index-check-tag tag-unindexed">unindexed</span>'
             + '<span class="blog-index-check-name">' + escHtml(u.name) + '</span>'
             + '<span class="blog-index-check-detail">' + escHtml(u.path) + '</span>'
             + '</li>';
    });
    html += section('Broken thumbnails', r.brokenThumbs, function(b, i) {
        return '<li class="blog-index-check-item" data-kind="broken-thumb" data-i="' + i + '" title="' + escHtml(b.thumbnail) + '">'
             + '<span class="blog-index-check-tag tag-broken">404 thumb</span>'
             + '<span class="blog-index-check-name">' + escHtml(b.entry.title || '(no title)') + '</span>'
             + '<span class="blog-index-check-detail">' + escHtml(b.thumbnail) + '</span>'
             + '</li>';
    });
    html += section('Bad date format', r.badDates, function(d, i) {
        return '<li class="blog-index-check-item" data-kind="bad-date" data-i="' + i + '">'
             + '<span class="blog-index-check-tag tag-bad-date">bad date</span>'
             + '<span class="blog-index-check-name">' + escHtml(d.entry.title || '(no title)') + '</span>'
             + '<span class="blog-index-check-detail">' + escHtml(d.reason) + '</span>'
             + '</li>';
    });

    body.innerHTML = html;
}

// Context menu --------------------------------------------------------
function bicHideContextMenu() {
    if (bicCtxMenuEl) { bicCtxMenuEl.remove(); bicCtxMenuEl = null; }
}

function bicShowContextMenu(e, kind, item) {
    e.preventDefault();
    bicHideContextMenu();
    const menu = document.createElement('div');
    menu.className = 'admin-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top  = e.clientY + 'px';

    function addItem(label, fn) {
        const el = document.createElement('div');
        el.className = 'admin-context-menu-item';
        el.textContent = label;
        el.addEventListener('click', function() { bicHideContextMenu(); fn(); });
        menu.appendChild(el);
    }

    if (kind === 'orphan') {
        addItem('Stage: remove JSON entry', function() { bicStageRemoveJsonEntry(item.array, item.entry.href); });
    } else if (kind === 'unindexed') {
        addItem('Stage: delete HTML file', function() { bicStageDeleteHtml(item.path, item.sha); });
    } else if (kind === 'broken-thumb') {
        addItem('Copy thumbnail path', function() {
            navigator.clipboard.writeText(item.thumbnail).catch(function() {});
        });
    } else if (kind === 'bad-date') {
        addItem('Copy entry title', function() {
            navigator.clipboard.writeText(item.entry.title || '').catch(function() {});
        });
    }

    document.body.appendChild(menu);
    bicCtxMenuEl = menu;
    const rect = menu.getBoundingClientRect();
    if (rect.right  > window.innerWidth)  menu.style.left = (window.innerWidth  - rect.width  - 4) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top  = (window.innerHeight - rect.height - 4) + 'px';
}

async function bicStageRemoveJsonEntry(arrayName, href) {
    let json;
    try { json = await fetchBlogDataJson(); }
    catch (err) { alert('Failed to load blog-data.json: ' + (err.message || err)); return; }
    const found = findEntryByHref(json, href);
    if (!found) { alert('Entry no longer present in blog-data.json.'); return; }
    json[found.array].splice(found.index, 1);
    ChangeQueue.replaceOrAdd(
        function(a) { return a.type === 'updateBlogIndex'; },
        { type: 'updateBlogIndex', path: BLOG_DATA_PATH, content: JSON.stringify(json, null, 4) }
    );
    AdminToolManager.open('show-changes');
}

function bicStageDeleteHtml(path, sha) {
    ChangeQueue.replaceOrAdd(
        function(a) { return a.type === 'deleteFile' && a.path === path; },
        { type: 'deleteFile', path: path, sha: sha }
    );
    AdminToolManager.open('show-changes');
}

// Bootstrap ----------------------------------------------------------
function bicInit() {
    if (document.body.dataset.pageRole !== 'admin') return;

    AdminToolManager.register({
        id:      'blog-index-check',
        label:   '🩺 Blog Index Check',
        panelId: 'blog-index-check-panel',
        order:   40,
        onOpen:  function() { if (!bicLoaded) bicRunCheck(); else bicRender(); }
    });

    // After a successful commit the report is stale.
    ChangeQueue.onCommitSuccess(function() { bicLoaded = false; bicReport = null; });

    bindClick('blog-index-check-close',  function() { AdminToolManager.close('blog-index-check'); });
    bindClick('blog-index-check-reload', function() {
        if (bicLoading) return;
        bicLoaded = false;
        bicRunCheck();
    });

    const body = document.getElementById('blog-index-check-body');
    if (body) body.addEventListener('contextmenu', function(e) {
        const row = e.target.closest('.blog-index-check-item');
        if (!row || !bicReport) return;
        const kind = row.dataset.kind;
        const i = parseInt(row.dataset.i, 10);
        if (isNaN(i)) return;
        let item = null;
        if (kind === 'orphan')        item = bicReport.orphans[i];
        else if (kind === 'unindexed')   item = bicReport.unindexed[i];
        else if (kind === 'broken-thumb') item = bicReport.brokenThumbs[i];
        else if (kind === 'bad-date')    item = bicReport.badDates[i];
        if (item) bicShowContextMenu(e, kind, item);
    });

    document.addEventListener('click', function(e) {
        if (bicCtxMenuEl && !bicCtxMenuEl.contains(e.target)) bicHideContextMenu();
    });
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') bicHideContextMenu();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bicInit);
} else {
    bicInit();
}
