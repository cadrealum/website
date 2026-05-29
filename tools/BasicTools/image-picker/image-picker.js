/* Image Picker — read-only image browser for the basic (restricted) page.
   Lets contributors drag image paths into the editor's thumbnail / image-block /
   slideshow / contributor inputs, or copy a path via right-click.

   Anonymous: uses AuthManager/github-api.js → ghGetTree, which omits the
   Authorization header when no token is in localStorage. Public-repo trees
   are readable without auth (60 req/hr/IP).

   No edits, no commits, no PAT, no localStorage writes — strictly browse + copy.
   Loaded only on tools/post-generator.html (gated by data-page-role="basic"). */

const IMG_PICKER_BRANCH = 'main';

let ipServerTree = null;
let ipExpanded = new Set();
let ipLoaded = false;
let ipLoading = false;
let ipPanelOpen = false;
let ipCtxMenuEl = null;

async function ipFetchTree() {
    const data = await ghGetTree(IMG_PICKER_BRANCH, true);
    return ipBuildHierarchy(data.tree || []);
}

function ipBuildHierarchy(flatEntries) {
    const root = { name: 'Blog-Images', path: 'images/Blog-Images', type: 'folder', children: [] };
    const folderMap = new Map();
    folderMap.set('images/Blog-Images', root);

    flatEntries.forEach(function(e) {
        if (!e.path.startsWith('images/Blog-Images/')) return;
        if (e.type !== 'tree') return;
        folderMap.set(e.path, { name: e.path.split('/').pop(), path: e.path, type: 'folder', children: [] });
    });
    flatEntries.forEach(function(e) {
        if (!e.path.startsWith('images/Blog-Images/')) return;
        if (e.type !== 'tree') return;
        const parent = folderMap.get(e.path.split('/').slice(0, -1).join('/'));
        const node = folderMap.get(e.path);
        if (parent && node) parent.children.push(node);
    });
    flatEntries.forEach(function(e) {
        if (!e.path.startsWith('images/Blog-Images/')) return;
        if (e.type !== 'blob') return;
        const name = e.path.split('/').pop();
        const ext = name.split('.').pop().toLowerCase();
        if (ext !== 'png' && ext !== 'jpg' && ext !== 'jpeg') return;
        const parent = folderMap.get(e.path.split('/').slice(0, -1).join('/'));
        if (parent) parent.children.push({ name: name, path: e.path, type: 'image' });
    });

    ipSortTree(root);
    return root;
}

function ipSortTree(node) {
    if (node.type !== 'folder') return;
    node.children.sort(function(a, b) {
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    node.children.forEach(ipSortTree);
}

function ipFindNode(tree, path) {
    if (!tree) return null;
    if (tree.path === path) return tree;
    if (tree.type !== 'folder') return null;
    for (let i = 0; i < tree.children.length; i++) {
        const f = ipFindNode(tree.children[i], path);
        if (f) return f;
    }
    return null;
}

function ipRenderTree() {
    const body = document.getElementById('image-picker-body');
    if (!body) return;
    if (!ipServerTree) {
        body.innerHTML = '<div class="image-picker-placeholder">No tree loaded.</div>';
        return;
    }
    body.innerHTML = '<div class="img-picker-tree">' + ipRenderNode(ipServerTree, 0) + '</div>';
}

function ipRenderNode(node, depth) {
    const padLeft = 8 + depth * 16;
    if (node.type === 'image') {
        // Pages live at /tools/, files are at /images/… — so ../<path> works
        // from this page. Lazy-loaded so big trees don't all fetch up front.
        const thumb = '<img class="img-picker-thumb" src="../' + escHtml(node.path)
                    + '" alt="" loading="lazy">';
        return '<div class="img-picker-item img-picker-image" data-path="' + escHtml(node.path)
             + '" title="' + escHtml(node.path)
             + '" draggable="true" style="padding-left: ' + padLeft + 'px">'
             + '<span class="img-picker-icon">' + thumb + '</span>'
             + '<span class="img-picker-name">' + escHtml(node.name) + '</span>'
             + '</div>';
    }
    const isRoot = node.path === 'images/Blog-Images';
    const expanded = isRoot || ipExpanded.has(node.path);
    const icon = expanded ? '📂' : '📁';
    let html = '<div class="img-picker-item img-picker-folder' + (expanded ? ' expanded' : '')
             + '" data-path="' + escHtml(node.path)
             + '" style="padding-left: ' + padLeft + 'px">'
             + '<span class="img-picker-icon">' + icon + '</span>'
             + '<span class="img-picker-name">' + escHtml(node.name) + '</span>'
             + '</div>';
    if (expanded) {
        if (node.children.length === 0) {
            html += '<div class="img-picker-empty" style="padding-left: ' + (padLeft + 22) + 'px">(empty)</div>';
        } else {
            node.children.forEach(function(child) { html += ipRenderNode(child, depth + 1); });
        }
    }
    return html;
}

function ipToggleFolder(path) {
    if (path === 'images/Blog-Images') return;
    if (ipExpanded.has(path)) ipExpanded.delete(path);
    else ipExpanded.add(path);
    ipRenderTree();
}

async function ipLoadAndRender() {
    const body = document.getElementById('image-picker-body');
    if (!body || ipLoading) return;
    ipLoading = true;
    body.innerHTML = '<div class="image-picker-placeholder">Loading images…</div>';
    try {
        ipServerTree = await ipFetchTree();
        ipLoaded = true;
        ipRenderTree();
    } catch (err) {
        body.innerHTML = '<div class="image-picker-placeholder image-picker-error">'
                       + escHtml(err.message || String(err))
                       + '<br><br><button class="btn-header-action" id="ip-retry">Retry</button>'
                       + '</div>';
        const r = document.getElementById('ip-retry');
        if (r) r.addEventListener('click', function() { ipLoaded = false; ipLoadAndRender(); });
    } finally {
        ipLoading = false;
    }
}

function ipShowContextMenu(e, node) {
    if (node.type !== 'image') return;  // folders have no useful action on basic
    e.preventDefault();
    ipHideContextMenu();
    const menu = document.createElement('div');
    menu.className = 'image-picker-context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top  = e.clientY + 'px';
    const item = document.createElement('div');
    item.className = 'image-picker-context-menu-item';
    item.textContent = 'Copy Relative Path';
    item.addEventListener('click', function() {
        ipHideContextMenu();
        navigator.clipboard.writeText(node.path).catch(function() {});
    });
    menu.appendChild(item);
    document.body.appendChild(menu);
    ipCtxMenuEl = menu;
    const rect = menu.getBoundingClientRect();
    if (rect.right  > window.innerWidth)  menu.style.left = (window.innerWidth  - rect.width  - 4) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top  = (window.innerHeight - rect.height - 4) + 'px';
}

function ipHideContextMenu() {
    if (ipCtxMenuEl) { ipCtxMenuEl.remove(); ipCtxMenuEl = null; }
}

// "Pick mode": when set, a single click on an image row delivers the path
// to ipPickCallback and ends pick mode. Used by the 📁 picker buttons next
// to image-path inputs in the post generator.
let ipPickCallback = null;

function ipSetPickMode(on) {
    const panel = document.getElementById('image-picker-panel');
    if (panel) panel.classList.toggle('image-picker-pick-mode', !!on);
    if (!on) ipPickCallback = null;
}

function ipOpenPanel() {
    const panel = document.getElementById('image-picker-panel');
    if (!panel) return;
    ipPanelOpen = true;
    panel.style.display = 'flex';
    panel.classList.remove('image-picker-modal-mode');
    const btn = document.getElementById('btn-open-image-picker');
    if (btn) btn.classList.add('image-picker-btn-active');
    if (!ipLoaded) ipLoadAndRender();
}

function ipTogglePanel() {
    if (ipPanelOpen) ipClosePanel();
    else             ipOpenPanel();
}

function ipClosePanel() {
    const panel = document.getElementById('image-picker-panel');
    if (!panel) return;
    ipPanelOpen = false;
    panel.style.display = 'none';
    panel.classList.remove('image-picker-modal-mode');
    const btn = document.getElementById('btn-open-image-picker');
    if (btn) btn.classList.remove('image-picker-btn-active');
    ipHideModalBackdrop();
    // If pick mode was active, let the caller know it was cancelled so they
    // can clear toggle-state on the originating 📁 button.
    const cb = ipPickCallback;
    ipSetPickMode(false);
    if (cb) cb(null);
}

// Modal version — reused panel element, with `image-picker-modal-mode` class
// flipping it into a centered overlay + a backdrop behind it.
function ipOpenAsModal() {
    const panel = document.getElementById('image-picker-panel');
    if (!panel) return;
    ipPanelOpen = true;
    panel.style.display = 'flex';
    panel.classList.add('image-picker-modal-mode');
    ipShowModalBackdrop();
    if (!ipLoaded) ipLoadAndRender();
}

function ipShowModalBackdrop() {
    let bd = document.getElementById('image-picker-modal-backdrop');
    if (!bd) {
        bd = document.createElement('div');
        bd.id = 'image-picker-modal-backdrop';
        bd.className = 'image-picker-modal-backdrop';
        bd.addEventListener('click', ipClosePanel);
        document.body.appendChild(bd);
    }
    bd.style.display = 'block';
}
function ipHideModalBackdrop() {
    const bd = document.getElementById('image-picker-modal-backdrop');
    if (bd) bd.style.display = 'none';
}

function ipInit() {
    if (document.body.dataset.pageRole !== 'basic') return;

    const openBtn = document.getElementById('btn-open-image-picker');
    if (openBtn) openBtn.addEventListener('click', ipTogglePanel);

    const closeBtn = document.getElementById('image-picker-close');
    if (closeBtn) closeBtn.addEventListener('click', ipClosePanel);

    const reloadBtn = document.getElementById('image-picker-reload');
    if (reloadBtn) reloadBtn.addEventListener('click', function() {
        if (ipLoading) return;
        ipLoaded = false;
        ipLoadAndRender();
    });

    const body = document.getElementById('image-picker-body');
    if (body) {
        body.addEventListener('click', function(e) {
            const imageRow = e.target.closest('.img-picker-image');
            if (imageRow && ipPickCallback) {
                const cb = ipPickCallback;
                ipPickCallback = null;     // prevent ipClosePanel from firing cb(null)
                const path = imageRow.dataset.path;
                ipClosePanel();
                cb(path || null);          // always notify so the originating button clears
                return;
            }
            const folderRow = e.target.closest('.img-picker-folder');
            if (folderRow) ipToggleFolder(folderRow.dataset.path);
        });
        body.addEventListener('contextmenu', function(e) {
            const row = e.target.closest('.img-picker-image');
            if (!row || !row.dataset.path) return;
            const node = ipFindNode(ipServerTree, row.dataset.path);
            if (node) ipShowContextMenu(e, node);
        });
    }

    document.addEventListener('click', function(e) {
        if (ipCtxMenuEl && !ipCtxMenuEl.contains(e.target)) ipHideContextMenu();
    });
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') ipHideContextMenu();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ipInit);
} else {
    ipInit();
}

// Public API consumed by the 📁 picker buttons in post-gen.js.
window.ImagePicker = {
    // Opens the picker AS A MODAL (centered overlay) — distinct from the
    // top-nav "📁 Browse Images" toggle which opens the inline sticky panel.
    openInPickMode: function(callback) {
        if (typeof callback !== 'function') return;
        ipPickCallback = callback;
        ipSetPickMode(true);
        ipOpenAsModal();
    },
    isOpen: function() { return ipPanelOpen; },
    close:  function() { ipClosePanel(); }
};
