/* Color Picker / Theme Editor — standalone page controller (tools/color-picker.html).
   Loads the public site's theme colors for BOTH themes from css/style.css, lets a
   signed-in admin edit them with a live preview (with a light/dark toggle), and
   commits the rewritten css/style.css directly to GitHub in a single commit.

   The website's theme is a set of CSS custom properties defined in two flat
   blocks in css/style.css: `:root { … }` (light) and `[data-theme="dark"] { … }`
   (dark). This tool ONLY touches the color/shadow tokens listed in CP_TOKENS —
   layout tokens (--space-*, --max-width, --radius) are never matched, so they
   can never be altered. The on-disk file is the source of truth: we fetch it,
   parse current values to seed the editor, and rewrite only changed token lines
   in place (everything else stays byte-identical).

   Standalone page (not an admin-sidebar tool): reads via ghFetch, commits via
   ghBatchCommit. Requires sign-in (inline gate) — viewing/editing/committing all
   need a token. Loaded on tools/color-picker.html after:
     post-gen-modals.js (auth modal), AuthManager/auth.js (isAuthenticated,
     getStoredToken, getCurrentUser, openAuthModal), AuthManager/github-api.js
     (ghFetch, ghBatchCommit), js/admin-utils.js (decodeBase64Utf8, bindClick). */

const CP_CSS_PATH = 'css/style.css';
const CP_BRANCH = 'main';

// Display order of the editable tokens. Every name here must exist in BOTH the
// :root and [data-theme="dark"] blocks. Adding a token to css/style.css? Add it
// here too (and give it a label below) to expose it in the editor.
const CP_TOKENS = [
    '--color-bg', '--color-surface', '--color-fg',
    '--color-primary', '--color-accent', '--color-complimentary',
    '--color-muted', '--color-border',
    '--shadow-soft', '--shadow-faq',
    '--color-on-primary', '--color-scrollbar-thumb', '--color-scrollbar-track',
    '--color-focus-ring', '--color-overlay', '--color-badge-bg',
    '--color-primary-tint', '--color-on-overlay', '--color-on-overlay-soft',
    '--color-on-overlay-muted'
];

// Human labels for the rows (fallback = the token name itself).
const CP_LABELS = {
    '--color-bg': 'Page background',
    '--color-surface': 'Surface / cards',
    '--color-fg': 'Foreground text',
    '--color-primary': 'Primary',
    '--color-accent': 'Accent',
    '--color-complimentary': 'Complimentary',
    '--color-muted': 'Muted text',
    '--color-border': 'Border',
    '--shadow-soft': 'Soft shadow',
    '--shadow-faq': 'Card / FAQ shadow',
    '--color-on-primary': 'Text on primary',
    '--color-scrollbar-thumb': 'Scrollbar thumb',
    '--color-scrollbar-track': 'Scrollbar track',
    '--color-focus-ring': 'Focus ring',
    '--color-overlay': 'Overlay backdrop',
    '--color-badge-bg': 'Badge over image',
    '--color-primary-tint': 'Primary tint',
    '--color-on-overlay': 'Text on overlay',
    '--color-on-overlay-soft': 'Control on overlay',
    '--color-on-overlay-muted': 'Muted on overlay'
};

const CP_THEMES = ['light', 'dark'];

// ---- Module state ---------------------------------------------------------
let cpLoaded = false;
let cpLoading = false;
let cpCommitting = false;
let cpFileText = '';                       // raw fetched css/style.css — rewrite source of truth
let cpFileSha = '';                        // informational
let cpOriginal = { light: {}, dark: {} };  // token -> committed value string (diff baseline)
let cpEdited   = { light: {}, dark: {} };  // token -> current edited value string
let cpKind = {};                           // token -> 'solid' | 'text' (classified at load)
let cpPreviewTheme = 'dark';               // in-iframe toggle; 'dark' matches the site default
let cpRenderTimer = null;                  // debounce handle for preview re-render

// ---- Small helpers --------------------------------------------------------
// Local HTML-escape so the page has no dependency on post-gen.js (the blog
// generator) just for one helper.
function cpEsc(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function cpEscRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function cpDeepCopy(o) { return JSON.parse(JSON.stringify(o)); }

// rgb(r, g, b) -> #rrggbb (null if not a plain solid rgb()).
function cpRgbToHex(s) {
    const m = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(s || '');
    if (!m) return null;
    return '#' + [m[1], m[2], m[3]].map(function(n) {
        return ('0' + Math.min(255, +n).toString(16)).slice(-2);
    }).join('');
}

// #rgb or #rrggbb -> rgb(r, g, b) (matching the file's "rgb(86, 58, 255)" spacing).
function cpHexToRgb(hex) {
    let h = (hex || '').replace('#', '');
    if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
    const n = parseInt(h, 16);
    if (isNaN(n) || h.length !== 6) return null;
    return 'rgb(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')';
}

// A token is "solid" (gets a native color picker) when its value is a #hex or a
// plain rgb() with no alpha. rgba()/hsl()/shadow strings are text-only.
function cpClassify(value) {
    const v = (value || '').trim();
    if (/^#[0-9a-f]{3}$/i.test(v) || /^#[0-9a-f]{6}$/i.test(v)) return 'solid';
    if (cpRgbToHex(v)) return 'solid';
    return 'text';
}

// Normalize any solid form to the #hex an <input type="color"> needs.
function cpToHex(value) {
    const v = (value || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + v.slice(1).replace(/(.)/g, '$1$1').toLowerCase();
    return cpRgbToHex(v) || '#000000';
}

// ---- Block extraction + parsing -------------------------------------------
// The two theme blocks are flat (only `--token: value;` declarations), so the
// first `}` after the selector closes the block. If a nested rule or media
// query is ever added inside :root / [data-theme="dark"], switch to a
// brace-depth scan here.
function cpExtractBlock(css, selectorRe) {
    const m = selectorRe.exec(css);
    if (!m) return null;
    const start = m.index + m[0].length;     // index just after the '{'
    const end = css.indexOf('}', start);     // first '}' = end of this flat block
    if (end === -1) return null;
    return { inner: css.slice(start, end), start: start, end: end };
}

const CP_RE_LIGHT = /:root\s*\{/;
const CP_RE_DARK  = /\[data-theme\s*=\s*"dark"\]\s*\{/;

function cpReadToken(inner, token) {
    const re = new RegExp(cpEscRe(token) + '\\s*:\\s*([^;]+);');
    const m = re.exec(inner);
    return m ? m[1].trim() : null;           // keeps parens: rgba(…) / full shadow strings
}

function cpParse() {
    const light = cpExtractBlock(cpFileText, CP_RE_LIGHT);
    const dark  = cpExtractBlock(cpFileText, CP_RE_DARK);
    if (!light || !dark) throw new Error('Could not locate :root / [data-theme="dark"] blocks in ' + CP_CSS_PATH);

    cpOriginal = { light: {}, dark: {} };
    cpKind = {};
    CP_TOKENS.forEach(function(t) {
        const lv = cpReadToken(light.inner, t);
        const dv = cpReadToken(dark.inner, t);
        if (lv === null) console.warn('color-picker: token not found in :root —', t);
        if (dv === null) console.warn('color-picker: token not found in [data-theme="dark"] —', t);
        if (lv !== null) cpOriginal.light[t] = lv;
        if (dv !== null) cpOriginal.dark[t] = dv;
        // Classify from whichever value we have (light preferred). Same token,
        // same format across themes in practice.
        cpKind[t] = cpClassify(lv !== null ? lv : dv);
    });
    cpEdited = cpDeepCopy(cpOriginal);
}

// ---- In-place rewrite (only changed, recognized tokens) -------------------
function cpReplaceTokenInBlock(inner, token, val) {
    const re = new RegExp('(' + cpEscRe(token) + '\\s*:\\s*)[^;]+(;)');
    if (!re.test(inner)) {
        console.warn('color-picker: cannot rewrite missing token —', token);
        return inner;
    }
    // Escape '$' in the replacement value so it can't be read as a $1 backref.
    return inner.replace(re, '$1' + val.replace(/\$/g, '$$$$') + '$2');
}

function cpBuildModifiedCss() {
    const css = cpFileText;
    const light = cpExtractBlock(css, CP_RE_LIGHT);
    const dark  = cpExtractBlock(css, CP_RE_DARK);
    if (!light || !dark) throw new Error('Could not locate :root / [data-theme="dark"] blocks');

    let li = light.inner, di = dark.inner;
    CP_TOKENS.forEach(function(t) {
        if (cpEdited.light[t] !== undefined && cpEdited.light[t] !== cpOriginal.light[t]) {
            li = cpReplaceTokenInBlock(li, t, cpEdited.light[t]);
        }
        if (cpEdited.dark[t] !== undefined && cpEdited.dark[t] !== cpOriginal.dark[t]) {
            di = cpReplaceTokenInBlock(di, t, cpEdited.dark[t]);
        }
    });

    // Splice the rewritten inners back in. Apply the LATER offset first so the
    // earlier block's start/end stay valid against the original string.
    let out = css;
    [{ start: light.start, end: light.end, inner: li },
     { start: dark.start,  end: dark.end,  inner: di }]
        .sort(function(a, b) { return b.start - a.start; })
        .forEach(function(b) { out = out.slice(0, b.start) + b.inner + out.slice(b.end); });
    return out;
}

// Count tokens that differ from the committed baseline (drives the commit button).
function cpChangedCount() {
    let n = 0;
    CP_THEMES.forEach(function(themeKey) {
        CP_TOKENS.forEach(function(t) {
            if (cpEdited[themeKey][t] !== undefined && cpEdited[themeKey][t] !== cpOriginal[themeKey][t]) n++;
        });
    });
    return n;
}

// ---- Editor UI ------------------------------------------------------------
function cpRenderEditors() {
    const body = document.getElementById('cp-editor');
    if (!body) return;
    body.innerHTML = CP_THEMES.map(cpRenderSection).join('');
}

function cpRenderSection(themeKey) {
    const title = themeKey === 'light' ? 'Light theme' : 'Dark theme';
    const rows = CP_TOKENS.map(function(t) {
        if (cpEdited[themeKey][t] === undefined) return '';   // token absent — skip row
        return cpRenderRow(themeKey, t);
    }).join('');
    return '<div class="cp-section">'
         + '<div class="cp-section-title">' + title + '</div>'
         + rows
         + '</div>';
}

function cpRenderRow(themeKey, token) {
    const value = cpEdited[themeKey][token];
    const label = CP_LABELS[token] || token;
    const solid = cpKind[token] === 'solid';
    const colorInput = solid
        ? '<input type="color" class="cp-color" value="' + cpEsc(cpToHex(value)) + '" title="Pick a color">'
        : '';
    return '<div class="cp-row' + (solid ? '' : ' cp-row-text-only') + '" '
         + 'data-theme-key="' + themeKey + '" data-token="' + cpEsc(token) + '">'
         + '<span class="cp-swatch" style="background:' + cpEsc(value) + '"></span>'
         + '<label class="cp-label">' + cpEsc(label) + ' <code>' + cpEsc(token) + '</code></label>'
         + colorInput
         + '<input type="text" class="cp-text" value="' + cpEsc(value) + '" spellcheck="false" autocomplete="off">'
         + '</div>';
}

// Delegated input handler on #cp-editor for both the color and text inputs.
// Keeps the pair in sync, updates the swatch immediately, and schedules a
// (debounced) preview re-render.
function cpOnInput(e) {
    const row = e.target.closest('.cp-row');
    if (!row) return;
    const themeKey = row.dataset.themeKey;
    const token = row.dataset.token;
    const swatch = row.querySelector('.cp-swatch');
    const textEl = row.querySelector('.cp-text');
    const colorEl = row.querySelector('.cp-color');

    if (e.target.classList.contains('cp-text')) {
        const val = textEl.value.trim();
        cpEdited[themeKey][token] = val;
        if (colorEl) {
            const hex = cpRgbToHex(val) || (/^#[0-9a-f]{3,6}$/i.test(val) ? cpToHex(val) : null);
            if (hex) colorEl.value = hex;
        }
        if (swatch) swatch.style.background = val;
        cpScheduleRender();
    } else if (e.target.classList.contains('cp-color')) {
        const rgb = cpHexToRgb(colorEl.value);
        if (rgb) {
            cpEdited[themeKey][token] = rgb;
            textEl.value = rgb;
            if (swatch) swatch.style.background = rgb;
            cpScheduleRender();
        }
    }
}

// ---- Live preview ---------------------------------------------------------
// The preview is the REAL public homepage, loaded same-origin so we can reach
// into its document and apply the edited colors live. That page links
// css/style.css (which defines the --color-* tokens), so edits show on the
// actual site — header, nav, cards and all.
const CP_PREVIEW_URL = '../index.html';

// CSS text (no <style> wrapper) re-declaring every edited token for both themes.
function cpBuildOverrideCss() {
    function block(map) {
        return CP_TOKENS.map(function(t) {
            return map[t] !== undefined ? '  ' + t + ': ' + map[t] + ';' : '';
        }).filter(Boolean).join('\n');
    }
    return ':root {\n' + block(cpEdited.light) + '\n}\n'
         + '[data-theme="dark"] {\n' + block(cpEdited.dark) + '\n}\n';
}

// Inject (or update) the edited-color overrides into the preview iframe's live
// document and set its theme. Same-origin, so we reach into contentDocument.
// Returns false if the document isn't ready/accessible yet — the iframe's load
// handler re-applies once it is.
function cpInjectIntoPreview() {
    const iframe = document.getElementById('cp-preview-iframe');
    let doc = null;
    try { doc = iframe && iframe.contentDocument; } catch (e) { doc = null; }
    if (!doc || !doc.head || !doc.documentElement) return false;
    let style = doc.getElementById('cp-theme-override');
    if (!style) {
        style = doc.createElement('style');
        style.id = 'cp-theme-override';
        doc.head.appendChild(style);   // last in <head> → wins the custom-property cascade
    }
    style.textContent = cpBuildOverrideCss();
    doc.documentElement.setAttribute('data-theme', cpPreviewTheme);
    return true;
}

function cpRenderPreview() {
    const iframe = document.getElementById('cp-preview-iframe');
    if (iframe && iframe.getAttribute('src') !== CP_PREVIEW_URL) {
        iframe.setAttribute('src', CP_PREVIEW_URL);   // load the real homepage once
    }
    cpInjectIntoPreview();                            // applies now if the doc is ready
    const toggle = document.getElementById('cp-preview-theme-toggle');
    if (toggle) toggle.innerHTML = cpPreviewTheme === 'dark' ? '🌓 Dark' : '🌞 Light';
}

// Debounced: push the edited colors into the live preview document + refresh
// the commit button. The swatch and the paired input update immediately (in
// cpOnInput); only these wait.
function cpScheduleRender() {
    if (cpRenderTimer) clearTimeout(cpRenderTimer);
    cpRenderTimer = setTimeout(function() {
        cpRenderTimer = null;
        cpInjectIntoPreview();
        cpUpdateCommitButton();
    }, 150);
}

function cpReset() {
    cpEdited = cpDeepCopy(cpOriginal);
    cpRenderEditors();
    cpRenderPreview();
    cpUpdateCommitButton();
}

// ---- Export / copy-CSS modal ----------------------------------------------
function cpExportText() {
    function block(sel, map) {
        return sel + ' {\n'
             + CP_TOKENS.map(function(t) {
                   return map[t] !== undefined ? '    ' + t + ': ' + map[t] + ';' : '';
               }).filter(Boolean).join('\n')
             + '\n}';
    }
    return block(':root', cpEdited.light) + '\n\n'
         + block('[data-theme="dark"]', cpEdited.dark) + '\n';
}

function cpOpenExport() {
    const overlay = document.getElementById('cp-export-modal-overlay');
    const ta = document.getElementById('cp-export-textarea');
    if (!overlay || !ta) return;
    ta.value = cpExportText();
    overlay.style.display = 'flex';
    setTimeout(function() { ta.focus(); ta.select(); }, 30);
}

function cpCloseExport() {
    const o = document.getElementById('cp-export-modal-overlay');
    if (o) o.style.display = 'none';
}

function cpCopyExport() {
    const ta = document.getElementById('cp-export-textarea');
    if (!ta) return;
    const flash = function() {
        const btn = document.getElementById('cp-export-copy');
        if (!btn) return;
        const prev = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(function() { btn.textContent = prev; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(ta.value).then(flash, function() {
            ta.select(); document.execCommand('copy'); flash();
        });
    } else {
        ta.select(); document.execCommand('copy'); flash();
    }
}

// ---- Commit-to-GitHub modal + execution -----------------------------------
function cpOpenCommit() {
    if (!isAuthenticated()) { if (typeof openAuthModal === 'function') openAuthModal(); return; }
    const n = cpChangedCount();
    if (!n) return;
    const overlay = document.getElementById('cp-commit-modal-overlay');
    if (!overlay) return;
    const count = document.getElementById('cp-commit-count');
    if (count) count.textContent = n + ' color' + (n === 1 ? '' : 's');
    const nameInput = document.getElementById('cp-commit-name');
    if (nameInput) { nameInput.value = ''; nameInput.placeholder = 'Update theme colors'; }
    overlay.style.display = 'flex';
    setTimeout(function() { if (nameInput) nameInput.focus(); }, 30);
}

function cpCloseCommit() {
    const o = document.getElementById('cp-commit-modal-overlay');
    if (o) o.style.display = 'none';
}

async function cpPerformCommit() {
    if (cpCommitting) return;
    let content;
    try {
        content = cpBuildModifiedCss();
    } catch (e) {
        cpSetCommitStatus('Could not build CSS: ' + (e.message || e), true);
        cpCloseCommit();
        return;
    }
    if (content === cpFileText) { cpCloseCommit(); return; }   // nothing to commit

    const nameInput = document.getElementById('cp-commit-name');
    const custom = nameInput ? nameInput.value.trim() : '';
    const message = 'Browser: ' + (custom || 'Update theme colors');

    cpCommitting = true;
    cpCloseCommit();
    cpSetCommitStatus('Committing…', false);
    cpUpdateCommitButton();
    try {
        const result = await ghBatchCommit({
            message: message,
            changes: [{ op: 'put', path: CP_CSS_PATH, content: content }],
            branch:  CP_BRANCH
        });
        // The committed file is now the new baseline so further edits diff cleanly.
        cpFileText = content;
        cpOriginal = cpDeepCopy(cpEdited);
        cpCommitting = false;
        cpUpdateCommitButton();
        cpSetCommitStatus('✓ Committed' + (result.retried ? ' (retried once)' : ''), false);
    } catch (err) {
        cpCommitting = false;
        cpUpdateCommitButton();
        cpSetCommitStatus('✗ Commit failed: ' + (err.message || String(err)), true);
    }
}

function cpSetCommitStatus(text, isError) {
    const el = document.getElementById('cp-commit-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'cp-commit-status' + (isError ? ' cp-commit-status-error' : '');
}

function cpUpdateCommitButton() {
    const btn = document.getElementById('cp-commit');
    if (!btn) return;
    const n = cpChangedCount();
    btn.disabled = cpCommitting || n === 0;
    btn.innerHTML = cpCommitting
        ? '⏳ Committing…'
        : (n > 0 ? '💾 Commit ' + n + ' change' + (n === 1 ? '' : 's') : '💾 Commit');
}

// ---- Load + render --------------------------------------------------------
async function cpFetchCss() {
    const resp = await ghFetch('GET', '/contents/' + CP_CSS_PATH);
    cpFileText = decodeBase64Utf8(resp.content);
    cpFileSha = resp.sha;
    cpParse();
}

async function cpLoadAndRender() {
    const editor = document.getElementById('cp-editor');
    if (!editor || cpLoading) return;
    cpLoading = true;
    editor.innerHTML = '<div class="cp-placeholder">Loading css/style.css…</div>';
    try {
        await cpFetchCss();
        cpLoaded = true;
        cpRenderEditors();
        cpRenderPreview();
        cpUpdateCommitButton();
    } catch (err) {
        editor.innerHTML = '<div class="cp-placeholder cp-error">'
                         + cpEsc(err.message || String(err))
                         + '<br><br><button class="cp-btn" id="cp-retry">Retry</button>'
                         + '</div>';
        const r = document.getElementById('cp-retry');
        if (r) r.addEventListener('click', function() { cpLoaded = false; cpLoadAndRender(); });
    } finally {
        cpLoading = false;
    }
}

// ---- Auth gate ------------------------------------------------------------
// Show the editor only when signed in. Re-evaluated whenever auth.js re-renders
// the #auth-chip (sign in / out) via a MutationObserver — no auth.js changes.
function cpApplyAuthGate() {
    const authed = isAuthenticated();
    const gate = document.getElementById('cp-signin-gate');
    const app  = document.getElementById('cp-app');
    if (gate) gate.style.display = authed ? 'none' : 'flex';
    if (app)  app.style.display  = authed ? 'flex' : 'none';
    if (authed && !cpLoaded && !cpLoading) cpLoadAndRender();
}

// ---- Bootstrap ------------------------------------------------------------
function cpInit() {
    cpApplyAuthGate();

    // Re-run the gate when the auth chip changes (sign in / out happen via the
    // shared auth modal, which re-renders #auth-chip on success).
    const chip = document.getElementById('auth-chip');
    if (chip && typeof MutationObserver !== 'undefined') {
        new MutationObserver(cpApplyAuthGate).observe(chip, { childList: true, subtree: true });
    }

    // Once the preview homepage finishes loading (including any header/footer
    // partials it injects), apply the current edits + theme to its document.
    const previewIframe = document.getElementById('cp-preview-iframe');
    if (previewIframe) previewIframe.addEventListener('load', cpInjectIntoPreview);

    bindClick('cp-signin-btn', function() { if (typeof openAuthModal === 'function') openAuthModal(); });
    bindClick('cp-reload', function() { if (!cpLoading) { cpLoaded = false; cpLoadAndRender(); } });
    bindClick('cp-reset',  cpReset);
    bindClick('cp-export', cpOpenExport);
    bindClick('cp-commit', cpOpenCommit);
    bindClick('cp-preview-theme-toggle', function() {
        cpPreviewTheme = cpPreviewTheme === 'dark' ? 'light' : 'dark';
        cpRenderPreview();
    });

    const editor = document.getElementById('cp-editor');
    if (editor) editor.addEventListener('input', cpOnInput);

    // Commit-modal wiring
    bindClick('cp-commit-cancel',  cpCloseCommit);
    bindClick('cp-commit-confirm', cpPerformCommit);
    const cOverlay = document.getElementById('cp-commit-modal-overlay');
    if (cOverlay) cOverlay.addEventListener('click', function(e) { if (e.target === cOverlay) cpCloseCommit(); });

    // Export-modal wiring
    bindClick('cp-export-close', cpCloseExport);
    bindClick('cp-export-copy',  cpCopyExport);
    const eOverlay = document.getElementById('cp-export-modal-overlay');
    if (eOverlay) eOverlay.addEventListener('click', function(e) { if (e.target === eOverlay) cpCloseExport(); });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { cpCloseExport(); cpCloseCommit(); }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cpInit);
} else {
    cpInit();
}
