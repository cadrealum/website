/* Admin Tool Manager — singleton that:
   - Renders the tool button list in #admin-tools-list (sorted by `order`).
   - Coordinates "only one tool panel open at a time" — opening a tool
     auto-closes any currently-open one.

   Each tool registers itself at DOMContentLoaded:

       AdminToolManager.register({
           id:      'image-manager',
           label:   '📁 Display Images Folder',
           panelId: 'image-manager-panel',
           order:   20,                         // lower = earlier in the button list
           onOpen:  function() { ... },         // optional
           onClose: function() { ... }          // optional
       });

   Loaded on tools/post-generator-admin.html after AuthManager/auth.js and
   AuthManager/github-api.js, before any concrete admin tool script. */

const AdminToolManager = (function () {
    const tools = [];
    let active = null;

    function renderButtons() {
        const list = document.getElementById('admin-tools-list');
        const empty = document.getElementById('admin-tools-empty');
        if (!list) return;
        list.innerHTML = '';
        tools.sort(function(a, b) { return (a.order || 100) - (b.order || 100); });
        tools.forEach(function(t) {
            const btn = document.createElement('button');
            btn.className = 'admin-tool-btn' + (active === t.id ? ' admin-tool-btn-active' : '');
            btn.id = 'btn-tool-' + t.id;
            btn.innerHTML = t.label;
            btn.addEventListener('click', function() { toggle(t.id); });
            list.appendChild(btn);
        });
        if (empty) empty.style.display = tools.length ? 'none' : '';
    }

    function register(opts) {
        if (!opts || !opts.id || !opts.label || !opts.panelId) {
            console.warn('AdminToolManager.register: missing id/label/panelId', opts);
            return;
        }
        if (tools.some(function(t) { return t.id === opts.id; })) {
            console.warn('AdminToolManager.register: duplicate id', opts.id);
            return;
        }
        tools.push(opts);
        renderButtons();
    }

    function open(id) {
        if (active === id) return;
        if (active) close(active);
        const t = tools.find(function(x) { return x.id === id; });
        if (!t) return;
        const panel = document.getElementById(t.panelId);
        if (panel) panel.style.display = 'flex';
        const btn = document.getElementById('btn-tool-' + id);
        if (btn) btn.classList.add('admin-tool-btn-active');
        active = id;
        // Body class tells the rest of the UI (image picker panel, floating
        // Preview/Publish bar) that the right-side admin panel is occupying
        // 360px of the viewport, so they can shift left to stay clear of it.
        document.body.classList.add('admin-panel-open');
        if (typeof t.onOpen === 'function') {
            try { t.onOpen(); } catch (e) { console.error('AdminToolManager onOpen', id, e); }
        }
    }

    function close(id) {
        const t = tools.find(function(x) { return x.id === id; });
        if (!t) return;
        const panel = document.getElementById(t.panelId);
        if (panel) panel.style.display = 'none';
        const btn = document.getElementById('btn-tool-' + id);
        if (btn) btn.classList.remove('admin-tool-btn-active');
        if (active === id) {
            active = null;
            document.body.classList.remove('admin-panel-open');
        }
        if (typeof t.onClose === 'function') {
            try { t.onClose(); } catch (e) { console.error('AdminToolManager onClose', id, e); }
        }
    }

    function toggle(id) {
        if (active === id) close(id);
        else open(id);
    }

    return {
        register:  register,
        open:      open,
        close:     close,
        toggle:    toggle,
        getActive: function() { return active; }
    };
})();
