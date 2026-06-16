/* Shared editor settings + color-theme system for ALL tool pages
   (post-generator, post-generator-admin, editor home, color picker).

   Owns the tool-wide preference store (localStorage) and the two modals that
   live in the shared modal markup (post-gen-modals.js): the ⚙ Settings modal
   and the Editor Color Theme picker it opens.

   Load order: this MUST come AFTER post-gen-modals.js (it reads the injected
   modal element IDs) and AFTER AuthManager/auth.js (the "Keep Me Logged In" row
   calls isAuthenticated / makePersistent / readKeepLoggedInPref lazily). It is
   loaded BEFORE post-gen.js on the generator pages so window.PostGenSettings and
   the body `hide-thumbnails` class exist before the editor trees render. It
   self-initializes at the bottom — no other script needs to call into it.

   Some rows only make sense in the blog generator (image-folder thumbnails, the
   tutorial). Those pages carry a `data-page-role` on <body>; the home and color-
   picker pages don't, so those rows are hidden there. The Editor Color Theme row
   is shown everywhere — the theme is a device-wide preference. */

// ─── Settings (persisted in localStorage) ─────────────────────────────────────
// Single source of truth for tool-wide preferences:
//   - showImageThumbnails: render preview thumbnails in the image folder tab
//   - editorTheme:         which [data-editor-theme] palette paints the tools
// New settings: add to DEFAULT_SETTINGS, render a row in the modal HTML
// (post-gen-modals.js), and apply via applySettings().

const SETTINGS_KEY = 'cadre.postgen.settings.v1';
// editorTheme defaults to 'default' (the original color scheme) so first-time
// visitors see the current look. Valid values match the [data-editor-theme="…"]
// blocks in postGen-style.css and the cards in post-gen-modals.js.
// editorTint is an optional primary-color override (a #hex). '' = follow the
// theme's own accent; picking a theme resets it to '' so the template's
// preferred color wins, and the Primary Color control then overrides it.
const DEFAULT_SETTINGS = { showImageThumbnails: true, editorTheme: 'default', editorTint: '' };
const EDITOR_THEMES = ['default', 'light', 'lightgrey', 'grey', 'dark', 'black', 'winxp', 'sjsu', 'rose'];

function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        return Object.assign({}, DEFAULT_SETTINGS, raw ? JSON.parse(raw) : {});
    } catch (_) { return Object.assign({}, DEFAULT_SETTINGS); }
}
function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (_) {}
}
function applySettings(s) {
    document.body.classList.toggle('hide-thumbnails', !s.showImageThumbnails);
    const theme = EDITOR_THEMES.indexOf(s.editorTheme) >= 0 ? s.editorTheme : 'default';
    document.documentElement.setAttribute('data-editor-theme', theme);
    applyEditorTint(s.editorTint);
}

// ─── Primary-color tint ───────────────────────────────────────────────────────
// The tint overrides --accent (and its derived hover / dim tokens) via an inline
// style on <html>, which beats the [data-editor-theme] stylesheet rule, so it
// layers on top of whatever theme is active. Clearing it (removeProperty) hands
// the accent back to the theme's own value.

function tintHexToRgb(hex) {
    let h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
    const n = parseInt(h, 16);
    if (isNaN(n) || h.length !== 6) return null;
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
// Normalize any accent value (#rgb / #rrggbb / rgb()) to the #rrggbb an
// <input type="color"> needs; falls back to the base blue.
function tintToHex(value) {
    const v = String(value || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(v)) return ('#' + v.slice(1).replace(/(.)/g, '$1$1')).toLowerCase();
    const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
    if (m) return '#' + [m[1], m[2], m[3]].map(function(x) { return ('0' + parseInt(x, 10).toString(16)).slice(-2); }).join('');
    return '#6272f8';
}
function tintLighten(hex, f) {
    const c = tintHexToRgb(hex);
    if (!c) return hex;
    const mix = function(v) { return Math.round(v + (255 - v) * f); };
    return '#' + [mix(c.r), mix(c.g), mix(c.b)].map(function(v) { return ('0' + v.toString(16)).slice(-2); }).join('');
}
function tintRgba(hex, a) {
    const c = tintHexToRgb(hex);
    return c ? 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + a + ')' : hex;
}

function applyEditorTint(tint) {
    const root = document.documentElement.style;
    const hex = tint && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(tint) ? tintToHex(tint) : '';
    if (hex) {
        root.setProperty('--accent', hex);
        root.setProperty('--accent-hover', tintLighten(hex, 0.16));
        root.setProperty('--accent-dim', tintRgba(hex, 0.18));
    } else {
        root.removeProperty('--accent');
        root.removeProperty('--accent-hover');
        root.removeProperty('--accent-dim');
    }
}


window.PostGenSettings = {
    get: loadSettings,
    set: function(patch) {
        const next = Object.assign(loadSettings(), patch);
        saveSettings(next);
        applySettings(next);
        return next;
    }
};

function initSettingsModal() {
    const overlay     = document.getElementById('settings-modal-overlay');
    const openBtn     = document.getElementById('btn-open-settings');
    const closeBtn    = document.getElementById('settings-modal-close');
    const thumbsTog   = document.getElementById('setting-show-thumbnails');
    const keepRow     = document.getElementById('settings-row-keep-logged-in');
    const keepTog     = document.getElementById('setting-keep-logged-in');
    const replayBtn   = document.getElementById('setting-replay-tutorial');
    if (!overlay || !openBtn || !thumbsTog) return;

    // Image thumbnails + the tutorial only exist in the blog generator (the
    // pages that carry a data-page-role). Hide those rows elsewhere so the
    // home / color-picker Settings modal shows only what applies there.
    const generatorPage = document.body.hasAttribute('data-page-role');
    if (!generatorPage) {
        const thumbsRow = thumbsTog.closest('.settings-row');
        const replayRow = replayBtn && replayBtn.closest('.settings-row');
        if (thumbsRow) thumbsRow.style.display = 'none';
        if (replayRow) replayRow.style.display = 'none';
    }

    function syncKeepLoggedInRow() {
        // "Keep Me Logged In" is only meaningful when a token is actually stored.
        // Hide the row when nobody is signed in. The checkbox itself reads from
        // the SAME localStorage preference key (pg_keep_logged_in_pref) that the
        // sign-in modal uses, so both surfaces stay in sync.
        const authed = typeof isAuthenticated === 'function' && isAuthenticated();
        if (keepRow) keepRow.style.display = authed ? '' : 'none';
        if (keepTog) {
            keepTog.checked = typeof readKeepLoggedInPref === 'function'
                ? readKeepLoggedInPref()
                : authed;
        }
    }

    function open() {
        const s = loadSettings();
        thumbsTog.checked = !!s.showImageThumbnails;
        syncKeepLoggedInRow();
        overlay.style.display = 'flex';
    }
    function close() { overlay.style.display = 'none'; }

    openBtn.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && overlay.style.display === 'flex') close();
    });
    thumbsTog.addEventListener('change', function() {
        window.PostGenSettings.set({ showImageThumbnails: thumbsTog.checked });
    });
    if (replayBtn) replayBtn.addEventListener('click', function() {
        close();
        if (window.PostGenTutorial) window.PostGenTutorial.start();
    });
    const themeBtn = document.getElementById('setting-open-theme');
    if (themeBtn) themeBtn.addEventListener('click', function() { openThemeModal(); });
    if (keepTog) keepTog.addEventListener('change', function() {
        // Toggle just moves credentials between localStorage and sessionStorage.
        // The user stays logged in for the current tab either way; turning OFF
        // just means the token is dropped automatically when the browser closes.
        if (keepTog.checked) {
            if (typeof makePersistent === 'function') makePersistent();
        } else {
            if (typeof makeSessionOnly === 'function') makeSessionOnly();
        }
        // Persist the choice so the sign-in modal pre-fills with it next time.
        if (typeof writeKeepLoggedInPref === 'function') writeKeepLoggedInPref(keepTog.checked);
    });
}

// ─── Editor color theme picker ────────────────────────────────────────────────
// The theme modal (post-gen-modals.js) shows a Primary Color control over a card
// per preset. Clicking a card writes editorTheme (and clears the tint so the
// template's own accent wins) via PostGenSettings.set(), which re-applies live.
// The Primary Color input overrides that accent for any theme. The modal stays
// open so changes are visible behind it; "Done" closes it.

// Highlight the card matching the currently-saved theme.
function markActiveThemeCard() {
    const current = loadSettings().editorTheme;
    document.querySelectorAll('#theme-grid .theme-card').forEach(function(card) {
        card.classList.toggle('is-active', card.dataset.theme === current);
    });
}

// Highlight the swatch matching the saved tint. '' (no override) matches the
// "Theme" chip; a preset hex matches its swatch. A non-preset value matches none.
function syncTintControl() {
    const wrap = document.getElementById('theme-tint-swatches');
    if (!wrap) return;
    const tint = (loadSettings().editorTint || '').toLowerCase();
    wrap.querySelectorAll('.theme-tint-swatch').forEach(function(sw) {
        sw.classList.toggle('is-active', (sw.dataset.tint || '').toLowerCase() === tint);
    });
}

function openThemeModal() {
    const overlay = document.getElementById('theme-modal-overlay');
    if (!overlay) return;
    markActiveThemeCard();
    syncTintControl();
    overlay.style.display = 'flex';
}

function initThemeModal() {
    const overlay  = document.getElementById('theme-modal-overlay');
    const closeBtn = document.getElementById('theme-modal-close');
    const grid     = document.getElementById('theme-grid');
    const swatches = document.getElementById('theme-tint-swatches');
    if (!overlay || !grid) return;

    function close() { overlay.style.display = 'none'; }

    grid.addEventListener('click', function(e) {
        const card = e.target.closest('.theme-card');
        if (!card) return;
        const theme = card.dataset.theme;
        if (EDITOR_THEMES.indexOf(theme) < 0) return;
        // Picking a template resets the tint so its preferred accent takes over.
        window.PostGenSettings.set({ editorTheme: theme, editorTint: '' });
        markActiveThemeCard();
        syncTintControl();
    });
    if (swatches) swatches.addEventListener('click', function(e) {
        const sw = e.target.closest('.theme-tint-swatch');
        if (!sw) return;
        // data-tint '' is the "Theme" chip → clear the override.
        window.PostGenSettings.set({ editorTint: sw.dataset.tint || '' });
        syncTintControl();
    });
    if (closeBtn) closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && overlay.style.display === 'flex') close();
    });
}

// ─── Self-init ────────────────────────────────────────────────────────────────
// The shared modal HTML is injected synchronously by post-gen-modals.js (loaded
// before this script), so the elements already exist. applySettings runs now so
// the theme + thumbnails state is set before any later script paints content.
applySettings(loadSettings());
initSettingsModal();
initThemeModal();
