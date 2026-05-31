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

// Hover text: what each token actually affects on the live site.
const CP_DESC = {
    '--color-bg': 'The page background behind all content.',
    '--color-surface': 'Cards, the header bar, panels and input backgrounds.',
    '--color-fg': 'The main body and heading text color.',
    '--color-primary': 'Brand color: links, primary buttons, headings and the active nav item.',
    '--color-accent': 'Secondary accent — accent badges and gradients.',
    '--color-complimentary': 'Highlight color: heading underlines plus hover / active states.',
    '--color-muted': 'Secondary, de-emphasized text.',
    '--color-border': 'Borders, dividers and card outlines.',
    '--shadow-soft': 'Drop shadow on cards and modals (e.g. on hover).',
    '--shadow-faq': 'Softer shadow on cards / FAQ boxes.',
    '--color-on-primary': 'Text and icons sitting on a primary-colored fill (e.g. button labels).',
    '--color-scrollbar-thumb': 'The draggable scrollbar handle.',
    '--color-scrollbar-track': 'The scrollbar track and arrow buttons.',
    '--color-focus-ring': 'The glow ring around a focused input.',
    '--color-overlay': 'The dark backdrop behind the image lightbox / modals.',
    '--color-badge-bg': 'Translucent pill over imagery (e.g. the date on news cards).',
    '--color-primary-tint': 'Faint primary wash (e.g. slideshow arrow hover).',
    '--color-on-overlay': 'Text and icons on a dark overlay (lightbox caption, buttons).',
    '--color-on-overlay-soft': 'Translucent control background on a dark overlay (modal buttons).',
    '--color-on-overlay-muted': 'De-emphasized text on a dark overlay (image counter).'
};

const CP_THEMES = ['light', 'dark'];

// Editor grouping (dividers). Main colors first; the shadow "other items" last.
// Every CP_TOKENS entry must appear in exactly one group.
const CP_GROUPS = [
    { title: 'Main colors',       tokens: ['--color-bg', '--color-surface', '--color-fg', '--color-primary', '--color-accent', '--color-complimentary'] },
    { title: 'Text & borders',    tokens: ['--color-muted', '--color-border', '--color-on-primary', '--color-focus-ring'] },
    { title: 'Overlays & badges', tokens: ['--color-overlay', '--color-badge-bg', '--color-on-overlay', '--color-on-overlay-soft', '--color-on-overlay-muted', '--color-primary-tint'] },
    { title: 'Scrollbar',         tokens: ['--color-scrollbar-thumb', '--color-scrollbar-track'] },
    { title: 'Shadows',           tokens: ['--shadow-soft', '--shadow-faq'] }
];

// ---- Module state ---------------------------------------------------------
let cpLoaded = false;
let cpLoading = false;
let cpCommitting = false;
let cpFileText = '';                       // raw fetched css/style.css — rewrite source of truth
let cpFileSha = '';                        // informational
let cpOriginal = { light: {}, dark: {} };  // token -> committed value string (diff baseline)
let cpEdited   = { light: {}, dark: {} };  // token -> current edited value string
let cpKind = {};                           // token -> 'color' | 'text' (classified at load)
let cpActiveTheme = 'dark';                // which theme's palette is shown/previewed
let cpConvertTarget = 'hex';               // what the RGB⇄Hex button will convert to next
let cpRenderTimer = null;                  // debounce handle for preview re-render
let cpShowingOriginal = false;             // preview is showing committed colors (compare mode)

// Undo: a stack of prior cpEdited snapshots. We push one snapshot per field-edit
// session (captured on focusin, committed on the first input) plus before
// reset/load, so Undo / Ctrl+Z steps back one logical change at a time.
let cpUndoStack = [];
let cpFieldSnapshot = null;                // cpEdited copy taken when a field gains focus
let cpFieldPushed = false;                 // has this focus session's snapshot been pushed?

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

// Parse rgb()/rgba() -> { r, g, b, a } (a defaults to 1), or null.
function cpParseRgb(s) {
    const m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([0-9.]+)\s*)?\)$/i.exec(s || '');
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : parseFloat(m[4]) };
}

// True if the value is any editable color form (#hex, #hex8, rgb(), rgba()).
function cpIsColor(value) {
    const v = (value || '').trim();
    return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) || !!cpParseRgb(v);
}

// A token gets a native color box when its value is a color; shadow strings
// (and anything else) stay text-only.
function cpClassify(value) {
    return cpIsColor(value) ? 'color' : 'text';
}

// Normalize any color form to the #rrggbb an <input type="color"> needs
// (alpha is dropped for the box; it's preserved separately in cpColorFromHex).
function cpToHex(value) {
    const v = (value || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
    if (/^#[0-9a-f]{8}$/i.test(v)) return ('#' + v.slice(1, 7)).toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + v.slice(1).replace(/(.)/g, '$1$1').toLowerCase();
    const rgb = cpParseRgb(v);
    if (rgb) return '#' + [rgb.r, rgb.g, rgb.b].map(function(n) {
        return ('0' + Math.min(255, n).toString(16)).slice(-2);
    }).join('');
    return '#000000';
}

// Build the new token value from a color-box #hex, preserving the alpha of the
// value being replaced: a translucent rgba() stays rgba() (same alpha); an
// opaque value becomes a plain rgb(). Keeps the file's "rgb(86, 58, 255)" spacing.
function cpColorFromHex(hex, currentValue) {
    let h = (hex || '').replace('#', '');
    if (h.length === 3) h = h.replace(/(.)/g, '$1$1');
    const n = parseInt(h, 16);
    if (isNaN(n) || h.length !== 6) return null;
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const a = cpAlphaOf(currentValue || '');   // handles rgba() and #rrggbbaa
    if (a < 1) return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + cpFmtAlpha(a) + ')';
    return 'rgb(' + r + ', ' + g + ', ' + b + ')';
}

// Current alpha (0..1) of a color value: rgba()'s alpha, #rrggbbaa's, else 1.
function cpAlphaOf(value) {
    const v = (value || '').trim();
    if (/^#[0-9a-f]{8}$/i.test(v)) return parseInt(v.slice(7, 9), 16) / 255;
    const rgb = cpParseRgb(v);
    return rgb ? rgb.a : 1;
}

// Trim alpha to at most 2 decimals without trailing zeros (0.6, 0.12, 1).
function cpFmtAlpha(a) { return parseFloat(Math.max(0, Math.min(1, a)).toFixed(2)); }

// Re-apply an alpha (0..1) to a color value, keeping its RGB *and* its notation:
// a hex value stays hex (#rrggbb opaque / #rrggbbaa translucent); an rgb()/rgba()
// value stays rgb()/rgba() (matching the file's "rgb(86, 58, 255)" spacing).
function cpWithAlpha(currentValue, alpha) {
    const hex6 = cpToHex(currentValue);         // #rrggbb of the current RGB
    const a = cpFmtAlpha(alpha);
    const isHex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test((currentValue || '').trim());
    if (isHex) {
        if (a >= 1) return hex6;
        return hex6 + ('0' + Math.round(a * 255).toString(16)).slice(-2);   // #rrggbbaa
    }
    const n = parseInt(hex6.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (a >= 1) return 'rgb(' + r + ', ' + g + ', ' + b + ')';
    return 'rgba(' + r + ', ' + g + ', ' + b + ', ' + a + ')';
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
    // Show every color in the notation the file predominantly uses, so the
    // inputs start consistent (the "current set value system") instead of a mix
    // of hex / rgb / rgba. Applied to the baseline too → no spurious diff; the
    // convert button is set to offer the opposite notation.
    cpNormalizeToCurrentSystem();
    cpEdited = cpDeepCopy(cpOriginal);
}

// Pick the value system (hex vs rgb-family) most color tokens use, normalize
// cpOriginal to it, and point the convert button at the other one.
function cpNormalizeToCurrentSystem() {
    let hex = 0, rgb = 0;
    CP_THEMES.forEach(function(themeKey) {
        Object.keys(cpOriginal[themeKey]).forEach(function(t) {
            const v = cpOriginal[themeKey][t];
            if (!cpIsColor(v)) return;
            if (/^#/.test(v.trim())) hex++; else rgb++;
        });
    });
    const fmt = hex > rgb ? 'hex' : 'rgb';
    CP_THEMES.forEach(function(themeKey) {
        Object.keys(cpOriginal[themeKey]).forEach(function(t) {
            cpOriginal[themeKey][t] = cpConvertValue(cpOriginal[themeKey][t], fmt);
        });
    });
    cpConvertTarget = fmt === 'hex' ? 'rgb' : 'hex';
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
// Renders only the active theme's palette, grouped with dividers (main colors
// first, shadows last). The other theme stays hidden; the toolbar's theme
// button switches which one is shown (and previewed).
function cpRenderEditors() {
    const body = document.getElementById('cp-editor');
    if (!body) return;
    const theme = cpActiveTheme;
    body.innerHTML = CP_GROUPS.map(function(group) {
        const rows = group.tokens.map(function(t) {
            if (cpEdited[theme][t] === undefined) return '';   // token absent — skip
            return cpRenderRow(theme, t);
        }).join('');
        if (!rows) return '';
        return '<div class="cp-group">'
             + '<div class="cp-group-title">' + cpEsc(group.title) + '</div>'
             + rows
             + '</div>';
    }).join('');
}

function cpRenderRow(themeKey, token) {
    const value = cpEdited[themeKey][token];
    const label = CP_LABELS[token] || token;
    const isColor = cpKind[token] === 'color';
    // Every row uses the same 5-column grid so the text fields line up: color
    // tokens (incl. translucent rgba) get a native color box + an opacity slider
    // in columns 3-4; shadow tokens get empty spacers there (a shadow isn't a
    // single color a box/slider can edit).
    const colorCell = isColor
        ? '<input type="color" class="cp-color" value="' + cpEsc(cpToHex(value)) + '" title="Pick a color">'
        : '<span class="cp-color-spacer" aria-hidden="true"></span>';
    const alphaCell = isColor
        ? '<input type="range" class="cp-alpha" min="0" max="1" step="0.01" value="' + cpAlphaOf(value) + '" title="Opacity">'
        : '<span class="cp-alpha-spacer" aria-hidden="true"></span>';
    const desc = CP_DESC[token] || '';
    return '<div class="cp-row" '
         + 'data-theme-key="' + themeKey + '" data-token="' + cpEsc(token) + '"'
         + (desc ? ' title="' + cpEsc(desc) + '"' : '') + '>'
         + '<span class="cp-swatch" style="background:' + cpEsc(value) + '"></span>'
         + '<label class="cp-label">' + cpEsc(label) + ' <code>' + cpEsc(token) + '</code></label>'
         + colorCell
         + alphaCell
         + '<input type="text" class="cp-text" value="' + cpEsc(value) + '" spellcheck="false" autocomplete="off">'
         + '</div>';
}

// Delegated input handler on #cp-editor for both the color and text inputs.
// Keeps the pair in sync, updates the swatch immediately, and schedules a
// (debounced) preview re-render. The color box preserves the value's alpha
// (a translucent rgba stays rgba; an opaque value becomes a plain rgb()).
function cpOnInput(e) {
    const row = e.target.closest('.cp-row');
    if (!row) return;
    const themeKey = row.dataset.themeKey;
    const token = row.dataset.token;
    const swatch = row.querySelector('.cp-swatch');
    const textEl = row.querySelector('.cp-text');
    const colorEl = row.querySelector('.cp-color');
    const alphaEl = row.querySelector('.cp-alpha');

    if (e.target.classList.contains('cp-text')) {
        const val = textEl.value.trim();
        cpCaptureUndo();
        cpExitShowOriginal();
        cpEdited[themeKey][token] = val;
        if (cpIsColor(val)) {
            if (colorEl) colorEl.value = cpToHex(val);
            if (alphaEl) alphaEl.value = cpAlphaOf(val);
        }
        if (swatch) swatch.style.background = val;
        cpScheduleRender();
    } else if (e.target.classList.contains('cp-color')) {
        const val = cpColorFromHex(colorEl.value, cpEdited[themeKey][token]);
        if (val) {
            cpCaptureUndo();
            cpExitShowOriginal();
            cpEdited[themeKey][token] = val;
            textEl.value = val;
            if (swatch) swatch.style.background = val;
            cpScheduleRender();
        }
    } else if (e.target.classList.contains('cp-alpha')) {
        const val = cpWithAlpha(cpEdited[themeKey][token], parseFloat(alphaEl.value));
        cpCaptureUndo();
        cpExitShowOriginal();
        cpEdited[themeKey][token] = val;
        textEl.value = val;
        if (swatch) swatch.style.background = val;
        cpScheduleRender();
    }
}

// ---- Undo -----------------------------------------------------------------
// Push the pre-edit snapshot captured on focusin — once per focus session, on
// the first actual change. Called by cpOnInput before mutating cpEdited.
function cpCaptureUndo() {
    if (!cpFieldPushed && cpFieldSnapshot) {
        cpUndoStack.push(cpFieldSnapshot);
        cpFieldPushed = true;
        cpUpdateUndoButton();
    }
}

// Push the current state explicitly (for non-field edits: reset, load).
function cpPushUndo() {
    cpUndoStack.push(cpDeepCopy(cpEdited));
    cpUpdateUndoButton();
}

function cpUndo() {
    if (!cpUndoStack.length) return;
    cpEdited = cpUndoStack.pop();
    cpFieldSnapshot = null;
    cpFieldPushed = false;
    cpExitShowOriginal();
    cpRenderEditors();
    cpInjectIntoPreview();
    cpUpdateCommitButton();
    cpUpdateUndoButton();
}

function cpUpdateUndoButton() {
    const btn = document.getElementById('cp-undo');
    if (btn) btn.disabled = cpUndoStack.length === 0;
}

// ---- Live preview ---------------------------------------------------------
// The preview is the REAL public homepage, loaded same-origin so we can reach
// into its document and apply the edited colors live. That page links
// css/style.css (which defines the --color-* tokens), so edits show on the
// actual site — header, nav, cards and all.
const CP_PREVIEW_URL = '../index.html';

// CSS text (no <style> wrapper) re-declaring every token for both themes. In
// "show original" compare mode it emits the committed values instead of edits.
function cpBuildOverrideCss() {
    const src = cpShowingOriginal ? cpOriginal : cpEdited;
    function block(map) {
        return CP_TOKENS.map(function(t) {
            return map[t] !== undefined ? '  ' + t + ': ' + map[t] + ';' : '';
        }).filter(Boolean).join('\n');
    }
    return ':root {\n' + block(src.light) + '\n}\n'
         + '[data-theme="dark"] {\n' + block(src.dark) + '\n}\n';
}

// Inject (or update) the color overrides into the preview iframe's live
// document and set its theme to the active one. Same-origin, so we reach into
// contentDocument. The override re-declares both :root and [data-theme="dark"];
// setting data-theme picks which the preview shows. Returns false if the
// document isn't ready/accessible yet — the iframe's load handler re-applies.
function cpInjectIntoPreview() {
    const iframe = document.getElementById('cp-preview-iframe');
    let doc = null;
    try { doc = iframe && iframe.contentDocument; } catch (e) { doc = null; }
    if (!doc || !doc.head) return false;
    let style = doc.getElementById('cp-theme-override');
    if (!style) {
        style = doc.createElement('style');
        style.id = 'cp-theme-override';
        doc.head.appendChild(style);   // last in <head> → wins the custom-property cascade
    }
    style.textContent = cpBuildOverrideCss();
    if (doc.documentElement) doc.documentElement.setAttribute('data-theme', cpActiveTheme);
    // The background squares (js/bg-squares.js) bake --color-primary/-accent/
    // -complimentary into each square's inline style at paint time, so a CSS
    // override alone won't recolor them — re-call the homepage's painter so it
    // re-reads the (now overridden) palette. Guarded: it only exists once the
    // iframe's scripts have run, and only repaints on wide enough viewports.
    try {
        const win = iframe.contentWindow;
        if (win && typeof win.paintBgSquares === 'function') win.paintBgSquares();
    } catch (e) { /* cross-frame / not ready — ignore */ }
    return true;
}

// ---- Active theme toggle --------------------------------------------------
// Switches which theme's palette is shown in the editor AND previewed.
function cpToggleTheme() {
    cpActiveTheme = cpActiveTheme === 'dark' ? 'light' : 'dark';
    cpUpdateThemeButton();
    cpRenderEditors();
    cpInjectIntoPreview();
}

function cpUpdateThemeButton() {
    const btn = document.getElementById('cp-theme-toggle');
    if (btn) btn.textContent = cpActiveTheme === 'dark' ? '🌙 Dark' : '☀️ Light';
}

// ---- RGB ⇄ Hex conversion -------------------------------------------------
// Convert one color value to the target notation, preserving alpha (rgba <->
// #rrggbbaa). Non-colors (shadows) pass through untouched.
function cpConvertValue(value, fmt) {
    if (!cpIsColor(value)) return value;
    const hex6 = cpToHex(value);             // #rrggbb of the RGB channels
    const a = cpAlphaOf(value);              // 0..1
    if (fmt === 'hex') {
        if (a >= 1) return hex6;
        return hex6 + ('0' + Math.round(a * 255).toString(16)).slice(-2);   // #rrggbbaa
    }
    const n = parseInt(hex6.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return a >= 1 ? 'rgb(' + r + ', ' + g + ', ' + b + ')'
                  : 'rgba(' + r + ', ' + g + ', ' + b + ', ' + cpFmtAlpha(a) + ')';
}

// Convert every color token (both themes) to the current target notation, then
// flip the target. Undoable as a single step; the preview is visually identical.
function cpConvertAll() {
    cpPushUndo();
    const fmt = cpConvertTarget;
    CP_THEMES.forEach(function(themeKey) {
        Object.keys(cpEdited[themeKey]).forEach(function(t) {
            cpEdited[themeKey][t] = cpConvertValue(cpEdited[themeKey][t], fmt);
        });
    });
    cpConvertTarget = fmt === 'hex' ? 'rgb' : 'hex';
    cpExitShowOriginal();
    cpUpdateConvertButton();
    cpRenderEditors();
    cpInjectIntoPreview();
    cpUpdateCommitButton();
    cpUpdateUndoButton();
}

function cpUpdateConvertButton() {
    const btn = document.getElementById('cp-convert');
    if (btn) btn.textContent = cpConvertTarget === 'hex' ? '⇄ Hex' : '⇄ RGB';
}

function cpRenderPreview() {
    const iframe = document.getElementById('cp-preview-iframe');
    if (iframe && iframe.getAttribute('src') !== CP_PREVIEW_URL) {
        iframe.setAttribute('src', CP_PREVIEW_URL);   // load the real homepage once
    }
    cpInjectIntoPreview();                            // applies now if the doc is ready
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

// ---- Show original (compare) ----------------------------------------------
// Toggle the preview between the edited palette and the committed baseline so
// the user can A/B compare. Any edit cancels it (cpExitShowOriginal).
function cpToggleShowOriginal() {
    cpShowingOriginal = !cpShowingOriginal;
    cpUpdateShowOriginalButton();
    cpInjectIntoPreview();
}

function cpExitShowOriginal() {
    if (!cpShowingOriginal) return;
    cpShowingOriginal = false;
    cpUpdateShowOriginalButton();
}

function cpUpdateShowOriginalButton() {
    const btn = document.getElementById('cp-show-original');
    if (!btn) return;
    btn.classList.toggle('cp-btn-active', cpShowingOriginal);
    btn.textContent = cpShowingOriginal ? '👁 Showing original' : '👁 Show original';
}

function cpReset() {
    cpPushUndo();
    cpEdited = cpDeepCopy(cpOriginal);
    cpExitShowOriginal();
    cpRenderEditors();
    cpRenderPreview();
    cpUpdateCommitButton();
}

// ---- Save / load palette file ---------------------------------------------
// Build the palette object written by Save-to-file and the template saver.
function cpBuildPaletteData(name) {
    const data = { version: 1, savedAt: new Date().toISOString(), light: {}, dark: {} };
    if (name) data.name = name;
    CP_THEMES.forEach(function(themeKey) {
        CP_TOKENS.forEach(function(t) {
            if (cpEdited[themeKey][t] !== undefined) data[themeKey][t] = cpEdited[themeKey][t];
        });
    });
    return data;
}

function cpSaveFile() {
    const data = cpBuildPaletteData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cadre-theme-colors.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}

// Apply a parsed palette object ({light:{token:val}, dark:{…}}) over the current
// edited palette. Only known tokens are touched; the rest are left as-is.
// Shared by Load-file and the template buttons. Returns true on success.
function cpApplyPaletteData(data, sourceLabel) {
    if (!data || (typeof data.light !== 'object' && typeof data.dark !== 'object')) {
        alert((sourceLabel || 'That file') + " doesn't look like a saved palette.");
        return false;
    }
    cpPushUndo();
    CP_THEMES.forEach(function(themeKey) {
        const src = data[themeKey];
        if (!src || typeof src !== 'object') return;
        CP_TOKENS.forEach(function(t) {
            // Only apply known tokens that exist in the current palette.
            if (cpEdited[themeKey][t] !== undefined && typeof src[t] === 'string') {
                cpEdited[themeKey][t] = src[t].trim();
            }
        });
    });
    cpExitShowOriginal();
    cpRenderEditors();
    cpInjectIntoPreview();
    cpUpdateCommitButton();
    return true;
}

function cpLoadFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function() {
        let data;
        try { data = JSON.parse(reader.result); }
        catch (e) { alert('Could not read that file — it is not valid JSON.'); return; }
        cpApplyPaletteData(data, 'That file');
    };
    reader.readAsText(file);
}

// ---- Color templates (tools/color-templates/) -----------------------------
// Root *.json = base templates; each subfolder = a category (collapsible).
const CP_TEMPLATES_DIR = 'tools/color-templates';
let cpTemplatesLoaded = false;
let cpTemplateTree = { root: [], categories: [] };   // categories: [{name, path, templates:[]}]
let cpOpenCategories = {};                            // category name -> expanded?
let cpPendingTemplate = null;                         // {path, name} awaiting discard-changes confirm

// "ocean-breeze.json" -> "Ocean Breeze"
function cpTemplateLabel(name) {
    return (name || '').replace(/\.json$/i, '').replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, function(c) { return c.toUpperCase(); });
}
// "AI-Generated" -> "AI Generated" (preserve case)
function cpCategoryLabel(name) { return (name || '').replace(/[-_]+/g, ' ').trim(); }

function cpIsJsonFile(it) { return it && it.type === 'file' && /\.json$/i.test(it.name); }
function cpByName(a, b) { return a.name.localeCompare(b.name); }

function cpTemplateButtonHtml(it) {
    return '<button class="cp-template-btn" data-path="' + cpEsc(it.path)
         + '" data-name="' + cpEsc(it.name) + '" title="Load the '
         + cpEsc(cpTemplateLabel(it.name)) + ' color scheme">'
         + cpEsc(cpTemplateLabel(it.name)) + '</button>';
}

async function cpFetchTemplates() {
    if (cpTemplatesLoaded) return;
    const list = document.getElementById('cp-templates-list');
    if (!list) return;
    try {
        const items = await ghFetch('GET', '/contents/' + CP_TEMPLATES_DIR);
        const arr = Array.isArray(items) ? items : [];
        const dirs = arr.filter(function(it) { return it.type === 'dir'; }).sort(cpByName);
        const categories = [];
        for (let i = 0; i < dirs.length; i++) {
            let templates = [];
            try {
                const sub = await ghFetch('GET', '/contents/' + dirs[i].path);
                templates = (Array.isArray(sub) ? sub : []).filter(cpIsJsonFile).sort(cpByName);
            } catch (e) { /* unreadable subfolder — show it empty */ }
            categories.push({ name: dirs[i].name, path: dirs[i].path, templates: templates });
        }
        cpTemplateTree = { root: arr.filter(cpIsJsonFile).sort(cpByName), categories: categories };
        cpTemplatesLoaded = true;
        cpRenderTemplates();
    } catch (err) {
        // 404 → folder doesn't exist yet; other errors (private repo / rate limit
        // while signed out) → leave unloaded so sign-in retries.
        if (err && err.status === 404) {
            cpTemplatesLoaded = true;
            cpTemplateTree = { root: [], categories: [] };
            cpRenderTemplates();
        } else {
            list.innerHTML = '<span class="cp-templates-empty">Sign in to load templates.</span>';
        }
    }
}

function cpRenderTemplates() {
    const list = document.getElementById('cp-templates-list');
    if (list) {
        list.innerHTML = cpTemplateTree.root.length
            ? cpTemplateTree.root.map(cpTemplateButtonHtml).join('')
            : '<span class="cp-templates-empty">No templates yet.</span>';
    }
    const cats = document.getElementById('cp-categories');
    if (cats) {
        cats.innerHTML = cpTemplateTree.categories.map(function(cat) {
            const open = !!cpOpenCategories[cat.name];
            const body = cat.templates.length
                ? cat.templates.map(cpTemplateButtonHtml).join('')
                : '<span class="cp-templates-empty">Empty — right-click to delete.</span>';
            return '<div class="cp-templates-group" data-category="' + cpEsc(cat.name) + '">'
                 + '<button class="cp-templates-toggle' + (open ? ' cp-templates-toggle-open' : '') + '" '
                 +   'data-category="' + cpEsc(cat.name) + '" type="button" aria-expanded="' + open + '">'
                 +   '<span class="cp-templates-caret">▸</span> ' + cpEsc(cpCategoryLabel(cat.name))
                 + '</button>'
                 + '<div class="cp-templates-list cp-cat-list" style="display:' + (open ? 'flex' : 'none') + '">'
                 +   body
                 + '</div></div>';
        }).join('');
    }
}

function cpToggleCategory(name) {
    cpOpenCategories[name] = !cpOpenCategories[name];
    cpRenderTemplates();
}

// Clicking a template: warn first if there are uncommitted changes.
function cpRequestTemplate(path, name) {
    if (cpChangedCount() > 0) {
        cpPendingTemplate = { path: path, name: name };
        const nameEl = document.getElementById('cp-template-name');
        if (nameEl) nameEl.textContent = cpTemplateLabel(name);
        const overlay = document.getElementById('cp-template-modal-overlay');
        if (overlay) overlay.style.display = 'flex';
    } else {
        cpLoadTemplate(path, name);
    }
}

async function cpLoadTemplate(path, name) {
    try {
        const resp = await ghFetch('GET', '/contents/' + path);
        const text = decodeBase64Utf8(resp.content);
        let data;
        try { data = JSON.parse(text); }
        catch (e) { alert('Template "' + cpTemplateLabel(name) + '" is not valid JSON.'); return; }
        cpApplyPaletteData(data, 'Template "' + cpTemplateLabel(name) + '"');
    } catch (err) {
        alert('Could not load template: ' + (err.message || err));
    }
}

function cpCloseTemplateModal() {
    const o = document.getElementById('cp-template-modal-overlay');
    if (o) o.style.display = 'none';
    cpPendingTemplate = null;
}

function cpConfirmTemplate() {
    const t = cpPendingTemplate;
    cpCloseTemplateModal();
    if (t) cpLoadTemplate(t.path, t.name);
}

// ---- Template management (save / new category / delete) -------------------
// All of these commit directly to the repo, so they require sign-in.
function cpRequireAuth() {
    if (typeof isAuthenticated === 'function' && isAuthenticated()) return true;
    if (typeof openAuthModal === 'function') openAuthModal();
    return false;
}

function cpSlug(s) {
    return (s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Full-tab "please wait" overlay while a GitHub API call is in flight.
// Reference-counted so nested show/hide (commit → re-fetch) behaves.
let cpLoadingCount = 0;
function cpShowLoading(msg) {
    cpLoadingCount++;
    const o = document.getElementById('cp-loading-overlay');
    if (!o) return;
    const t = o.querySelector('.cp-loading-text');
    if (t && msg) t.textContent = msg;
    o.style.display = 'flex';
}
function cpHideLoading() {
    cpLoadingCount = Math.max(0, cpLoadingCount - 1);
    if (cpLoadingCount === 0) {
        const o = document.getElementById('cp-loading-overlay');
        if (o) o.style.display = 'none';
    }
}

// Commit template file changes in one commit, then refresh the sidebar.
async function cpCommitTemplateChanges(message, changes) {
    cpShowLoading('Saving…');
    try {
        await ghBatchCommit({ message: 'Browser: ' + message, changes: changes, branch: CP_BRANCH });
        cpTemplatesLoaded = false;
        await cpFetchTemplates();
    } finally {
        cpHideLoading();
    }
}

// Save popup ----------------------------------------------------------------
function cpOpenSaveTemplate() {
    if (!cpRequireAuth()) return;
    const overlay = document.getElementById('cp-save-modal-overlay');
    const nameEl = document.getElementById('cp-save-name');
    const catEl = document.getElementById('cp-save-category');
    if (!overlay || !nameEl || !catEl) return;
    nameEl.value = '';
    catEl.innerHTML = '<option value="">Templates (top level)</option>'
        + cpTemplateTree.categories.map(function(c) {
            return '<option value="' + cpEsc(c.name) + '">' + cpEsc(cpCategoryLabel(c.name)) + '</option>';
        }).join('');
    overlay.style.display = 'flex';
    setTimeout(function() { nameEl.focus(); }, 30);
}

function cpCloseSaveTemplate() {
    const o = document.getElementById('cp-save-modal-overlay');
    if (o) o.style.display = 'none';
}

async function cpConfirmSaveTemplate() {
    const nameEl = document.getElementById('cp-save-name');
    const catEl = document.getElementById('cp-save-category');
    if (!nameEl || !catEl) return;
    const name = nameEl.value.trim();
    const slug = cpSlug(name);
    if (!slug) { alert('Please enter a template name.'); return; }
    const category = catEl.value;                 // '' = top level
    const dir = category ? (CP_TEMPLATES_DIR + '/' + category) : CP_TEMPLATES_DIR;
    const path = dir + '/' + slug + '.json';
    const content = JSON.stringify(cpBuildPaletteData(name), null, 4) + '\n';
    cpCloseSaveTemplate();
    try {
        if (category) cpOpenCategories[category] = true;
        await cpCommitTemplateChanges('add color template ' + path, [{ op: 'put', path: path, content: content }]);
    } catch (err) {
        alert('Could not save template: ' + (err.message || err));
    }
}

// New category (prompt → commit a .gitkeep so the empty folder persists) ------
async function cpNewCategory() {
    if (!cpRequireAuth()) return;
    const raw = (window.prompt('New category name:') || '').trim();
    if (!raw) return;
    const folder = raw.replace(/[^a-zA-Z0-9 _-]+/g, '').trim().replace(/\s+/g, '-');
    if (!folder) { alert('That name has no usable characters.'); return; }
    try {
        cpOpenCategories[folder] = true;
        await cpCommitTemplateChanges('add color template category ' + folder,
            [{ op: 'put', path: CP_TEMPLATES_DIR + '/' + folder + '/.gitkeep', content: '' }]);
    } catch (err) {
        alert('Could not create category: ' + (err.message || err));
    }
}

// Delete a single template ---------------------------------------------------
async function cpDeleteTemplate(path, name) {
    if (!cpRequireAuth()) return;
    if (!window.confirm('Delete template "' + cpTemplateLabel(name) + '"?\nThis commits the deletion to the repository.')) return;
    try {
        await cpCommitTemplateChanges('delete color template ' + path, [{ op: 'delete', path: path }]);
    } catch (err) {
        alert('Could not delete template: ' + (err.message || err));
    }
}

// Delete a whole category (every file inside it) -----------------------------
async function cpDeleteCategory(name) {
    if (!cpRequireAuth()) return;
    const cat = cpTemplateTree.categories.find(function(c) { return c.name === name; });
    if (!cat) return;
    if (!window.confirm('Delete category "' + cpCategoryLabel(name) + '" and everything in it?\nThis commits the deletion to the repository.')) return;
    try {
        // Re-list so we delete every file (templates + .gitkeep, etc.).
        let files = [];
        try {
            const sub = await ghFetch('GET', '/contents/' + cat.path);
            files = (Array.isArray(sub) ? sub : []).filter(function(it) { return it.type === 'file'; });
        } catch (e) { /* ignore — handled below */ }
        delete cpOpenCategories[name];
        if (!files.length) { cpTemplatesLoaded = false; await cpFetchTemplates(); return; }
        await cpCommitTemplateChanges('delete color template category ' + name,
            files.map(function(it) { return { op: 'delete', path: it.path }; }));
    } catch (err) {
        alert('Could not delete category: ' + (err.message || err));
    }
}

// Right-click context menu on the sidebar -----------------------------------
let cpCtxMenuEl = null;
function cpHideContextMenu() { if (cpCtxMenuEl) { cpCtxMenuEl.remove(); cpCtxMenuEl = null; } }

function cpShowContextMenu(e) {
    e.preventDefault();
    cpHideContextMenu();
    const items = [];
    const tplBtn = e.target.closest('.cp-template-btn');
    const catEl = e.target.closest('[data-category]');
    if (tplBtn) {
        items.push({ label: '🗑 Delete template', fn: function() { cpDeleteTemplate(tplBtn.dataset.path, tplBtn.dataset.name); } });
    } else if (catEl) {
        const cat = catEl.dataset.category;
        items.push({ label: '🗑 Delete category', fn: function() { cpDeleteCategory(cat); } });
    }
    items.push({ label: '＋ New category', fn: cpNewCategory });

    const menu = document.createElement('div');
    menu.className = 'cp-context-menu';
    items.forEach(function(it) {
        const el = document.createElement('div');
        el.className = 'cp-context-menu-item';
        el.textContent = it.label;
        el.addEventListener('click', function() { cpHideContextMenu(); it.fn(); });
        menu.appendChild(el);
    });
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    document.body.appendChild(menu);
    cpCtxMenuEl = menu;
    const r = menu.getBoundingClientRect();
    if (r.right > window.innerWidth) menu.style.left = (window.innerWidth - r.width - 4) + 'px';
    if (r.bottom > window.innerHeight) menu.style.top = (window.innerHeight - r.height - 4) + 'px';
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
        cpUpdateConvertButton();   // label reflects the system chosen at parse time
    } catch (err) {
        // Signed-out + read failed (e.g. a private repo or anonymous rate limit):
        // nudge them to the top-right sign-in rather than dumping a raw error.
        const signedOut = (typeof isAuthenticated === 'function') && !isAuthenticated();
        editor.innerHTML = signedOut
            ? '<div class="cp-placeholder">Sign in (top right) to load and edit the palette.</div>'
            : '<div class="cp-placeholder cp-error">'
                + cpEsc(err.message || String(err))
                + '<br><br><button class="cp-btn" id="cp-retry">Retry</button>'
                + '</div>';
        const r = document.getElementById('cp-retry');
        if (r) r.addEventListener('click', function() { cpLoaded = false; cpLoadAndRender(); });
    } finally {
        cpLoading = false;
    }
}

// ---- Load lifecycle -------------------------------------------------------
// The page is usable without signing in (browse + preview + export). Sign-in
// lives in the top-right navbar chip; committing prompts it. We just make sure
// the colors load, retrying after sign-in if an early anonymous fetch failed.
function cpEnsureLoaded() {
    if (!cpLoaded && !cpLoading) cpLoadAndRender();
}

// ---- Bootstrap ------------------------------------------------------------
function cpInit() {
    cpEnsureLoaded();
    cpFetchTemplates();

    // If sign-in happens after an early load failed (e.g. a private repo or a
    // rate-limited anonymous read), retry once the auth chip re-renders.
    const chip = document.getElementById('auth-chip');
    if (chip && typeof MutationObserver !== 'undefined') {
        new MutationObserver(function() { cpEnsureLoaded(); cpFetchTemplates(); })
            .observe(chip, { childList: true, subtree: true });
    }

    // Once the preview homepage finishes loading (including any header/footer
    // partials it injects), apply the current color edits to its document.
    const previewIframe = document.getElementById('cp-preview-iframe');
    if (previewIframe) previewIframe.addEventListener('load', cpInjectIntoPreview);

    bindClick('cp-theme-toggle', cpToggleTheme);
    bindClick('cp-convert', cpConvertAll);
    bindClick('cp-reload', function() { if (!cpLoading) { cpLoaded = false; cpLoadAndRender(); } });
    bindClick('cp-undo',   cpUndo);
    bindClick('cp-reset',  cpReset);
    bindClick('cp-save',   cpSaveFile);
    bindClick('cp-load',   function() { const i = document.getElementById('cp-load-input'); if (i) i.click(); });
    bindClick('cp-export', cpOpenExport);
    bindClick('cp-commit', cpOpenCommit);
    bindClick('cp-show-original', cpToggleShowOriginal);

    const loadInput = document.getElementById('cp-load-input');
    if (loadInput) loadInput.addEventListener('change', function() {
        if (this.files && this.files[0]) cpLoadFile(this.files[0]);
        this.value = '';   // allow re-loading the same file name
    });

    cpUpdateUndoButton();
    cpUpdateShowOriginalButton();
    cpUpdateThemeButton();
    cpUpdateConvertButton();

    const editor = document.getElementById('cp-editor');
    if (editor) {
        editor.addEventListener('input', cpOnInput);
        // Snapshot the palette when a field gains focus; cpCaptureUndo() commits
        // that snapshot to the undo stack on the field's first actual change.
        editor.addEventListener('focusin', function(e) {
            if (e.target.matches('.cp-text, .cp-color')) {
                cpFieldSnapshot = cpDeepCopy(cpEdited);
                cpFieldPushed = false;
            }
        });
    }

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

    // Templates sidebar: click delegation (category toggles + template buttons),
    // right-click menu, save button, and the two confirm/save modals.
    const tBar = document.getElementById('cp-templates');
    if (tBar) {
        tBar.addEventListener('click', function(e) {
            const toggle = e.target.closest('.cp-templates-toggle');
            if (toggle) { cpToggleCategory(toggle.dataset.category); return; }
            const btn = e.target.closest('.cp-template-btn');
            if (btn) cpRequestTemplate(btn.dataset.path, btn.dataset.name);
        });
        tBar.addEventListener('contextmenu', cpShowContextMenu);
    }
    bindClick('cp-template-save', cpOpenSaveTemplate);
    bindClick('cp-template-reload', async function() {
        cpShowLoading('Reloading…');
        cpTemplatesLoaded = false;
        try { await cpFetchTemplates(); } finally { cpHideLoading(); }
    });
    document.addEventListener('click', function(e) {
        if (cpCtxMenuEl && !cpCtxMenuEl.contains(e.target)) cpHideContextMenu();
    });

    // Discard-changes confirm modal (loading a template over edits)
    bindClick('cp-template-cancel',  cpCloseTemplateModal);
    bindClick('cp-template-confirm', cpConfirmTemplate);
    const tOverlay = document.getElementById('cp-template-modal-overlay');
    if (tOverlay) tOverlay.addEventListener('click', function(e) { if (e.target === tOverlay) cpCloseTemplateModal(); });

    // Save-as-template modal
    bindClick('cp-save-cancel',  cpCloseSaveTemplate);
    bindClick('cp-save-confirm', cpConfirmSaveTemplate);
    const sOverlay = document.getElementById('cp-save-modal-overlay');
    if (sOverlay) sOverlay.addEventListener('click', function(e) { if (e.target === sOverlay) cpCloseSaveTemplate(); });
    const saveName = document.getElementById('cp-save-name');
    if (saveName) saveName.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); cpConfirmSaveTemplate(); }
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') { cpCloseExport(); cpCloseCommit(); cpCloseTemplateModal(); cpCloseSaveTemplate(); cpHideContextMenu(); return; }
        // Ctrl/Cmd+Z → undo a color change. Skip when focus is in a modal field
        // (commit name, export textarea) so native text-undo still works there.
        if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
            if (e.target.closest && e.target.closest('.modal-overlay')) return;
            e.preventDefault();
            cpUndo();
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cpInit);
} else {
    cpInit();
}
