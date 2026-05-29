// ─── AuthManager: GitHub PAT auth foundation ──────────────────────────────────
//
// Provides identity + token storage for the post generator. Loads BEFORE the
// other post-gen scripts so its public surface is available to any future
// feature that needs to call the GitHub API.
//
// Public surface:
//     isAuthenticated()    → boolean
//     getStoredToken()     → string (empty if signed out)
//     getCurrentUser()     → { login, avatar } or null
//     GITHUB_OWNER         → string constant
//     GITHUB_REPO          → string constant
//
// All other functions in this file are internal.
//
// Security model is documented in the plan file. Short version: PAT lives in
// localStorage so it persists across reloads but is readable by any script on
// this origin. Acceptable for a small team of trusted authors; not acceptable
// for an admin panel handling third-party data.

// TODO: Fill in your GitHub username. Once set, the "Generate a token" link
// in the sign-in modal will deep-link to a token form pre-scoped to this repo.
const GITHUB_OWNER = 'cadrealum';
const GITHUB_REPO  = 'website';

const LS_KEYS = {
    pat:    'pg_pat',
    login:  'pg_user_login',
    avatar: 'pg_user_avatar',
    expiry: 'pg_pat_expiry',
    // AES key bytes (base64) used to encrypt `pat` at rest. Treated as a
    // credential so makePersistent/makeSessionOnly/signOut move/clear it
    // alongside the ciphertext it decrypts.
    key:    'pg_k'
};

// Decrypted token, held in memory only. Populated by warmDecryptToken() at
// load and by validateAndStorePAT() on sign-in. Keeping it here lets
// getStoredToken() stay synchronous (Web Crypto decryption is async) so the
// github-api.js / ghHeaders() call chain needs no changes. null = signed out.
let decryptedToken = null;

// Stores the user's last "Keep Me Logged In" choice so the sign-in modal and
// the settings toggle can pre-fill the right state on next open. Lives outside
// LS_KEYS because it survives signOut() — it's a preference, not credentials.
const LS_KEEP_PREF = 'pg_keep_logged_in_pref';   // '1' or '0'

function readKeepLoggedInPref() {
    const v = localStorage.getItem(LS_KEEP_PREF);
    if (v === null) return true;   // default ON (common case: stay logged in)
    return v === '1';
}
function writeKeepLoggedInPref(persistent) {
    try { localStorage.setItem(LS_KEEP_PREF, persistent ? '1' : '0'); } catch (_) {}
}

// Filenames for the redirect logic. Both files live in `tools/`.
const PAGE_BASIC_URL = 'post-generator.html';
const PAGE_ADMIN_URL = 'post-generator-admin.html';

// Returns 'basic' | 'admin' | undefined — set via data-page-role on <body>.
function getPageRole() { return document.body.dataset.pageRole; }

// ─── Public API ───────────────────────────────────────────────────────────────

// Credentials live in EITHER localStorage (persistent across browser sessions)
// or sessionStorage (cleared automatically when the browser/tab closes). The
// "Keep Me Logged In" setting picks which store is the source of truth —
// flipping it calls makePersistent() / makeSessionOnly() to move the values.
function isAuthenticated() {
    // Either we already decrypted a token this session, or there's an encrypted
    // blob on disk that warmDecryptToken() will turn into one. Checking the blob
    // too means the page-role gate works on first paint, before warm-up resolves.
    return !!decryptedToken
        || !!(localStorage.getItem(LS_KEYS.pat) || sessionStorage.getItem(LS_KEYS.pat));
}

// Synchronous by contract (ghHeaders() depends on it). Returns the in-memory
// decrypted token, populated by warmDecryptToken() at load or validateAndStorePAT()
// on sign-in. The on-disk value is ciphertext and is never returned directly.
function getStoredToken() {
    return decryptedToken || '';
}

function getCurrentUser() {
    if (!isAuthenticated()) return null;
    return {
        login:  localStorage.getItem(LS_KEYS.login)  || sessionStorage.getItem(LS_KEYS.login)  || '',
        avatar: localStorage.getItem(LS_KEYS.avatar) || sessionStorage.getItem(LS_KEYS.avatar) || ''
    };
}

function getTokenExpiry() {
    return localStorage.getItem(LS_KEYS.expiry) || sessionStorage.getItem(LS_KEYS.expiry) || '';
}

// True when credentials are in localStorage — i.e. user opted to stay logged
// in across browser restarts. False = sessionStorage only = this-tab-only.
function isPersistentLogin() {
    return !!localStorage.getItem(LS_KEYS.pat);
}

// Toggle ON: move sessionStorage credentials into localStorage so they survive
// browser restarts. No-op if values are already in localStorage.
function makePersistent() {
    Object.keys(LS_KEYS).forEach(function(field) {
        const key = LS_KEYS[field];
        const sVal = sessionStorage.getItem(key);
        if (sVal !== null && !localStorage.getItem(key)) {
            localStorage.setItem(key, sVal);
        }
        // Drop the sessionStorage copy now that localStorage owns it.
        sessionStorage.removeItem(key);
    });
}

// Toggle OFF: move localStorage credentials into sessionStorage so the user
// stays logged in for the current tab but is logged out on next browser open.
function makeSessionOnly() {
    Object.keys(LS_KEYS).forEach(function(field) {
        const key = LS_KEYS[field];
        const lVal = localStorage.getItem(key);
        if (lVal !== null) {
            sessionStorage.setItem(key, lVal);
            localStorage.removeItem(key);
        }
    });
}

// ─── Internals ────────────────────────────────────────────────────────────────

// Minimal local HTML-escape so this module has no dependency on post-gen.js.
function authEscape(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Token-at-rest encryption ──────────────────────────────────────────────────
//
// We encrypt the PAT with AES-GCM (Web Crypto) before writing it to storage so a
// casual scrape of localStorage (info-stealer malware grepping for `ghp_…`) finds
// opaque base64, not a usable token.
//
// HONEST LIMITATION: this is client-side crypto in a PUBLIC repo. The AES key
// (`pg_k`) is co-located with the ciphertext in the same store — it has to be,
// since the browser must decrypt unattended on reload. A targeted attacker who
// reads this source can re-run the derivation on a storage dump and recover the
// token. This raises the bar against OPPORTUNISTIC scraping only; it is NOT
// protection against a determined, code-aware attacker. Real protection would
// require session-only storage or a backend/OAuth flow.

// Uint8Array → binary string → base64. Mirrors the byte-bridge loop in
// github-api.js ghStringToBase64; needed because AES output is raw binary, not
// the ASCII the token itself is.
function bytesToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
}
function base64ToBytes(b64) {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
}

// Reads the AES key from `store` (pg_k), or generates+persists a fresh 256-bit
// one. Returns a CryptoKey. `create=false` returns null when no key exists
// (used by decrypt so a missing key fails gracefully rather than minting a new,
// useless one).
async function getOrCreateCryptoKey(store, create) {
    const existing = store.getItem(LS_KEYS.key);
    if (existing) {
        return crypto.subtle.importKey('raw', base64ToBytes(existing),
            { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }
    if (!create) return null;
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 },
        true, ['encrypt', 'decrypt']);
    const raw = await crypto.subtle.exportKey('raw', key);
    store.setItem(LS_KEYS.key, bytesToBase64(new Uint8Array(raw)));
    return key;
}

// plain → base64(IV ‖ ciphertext). 12-byte random IV per encryption, prepended.
async function encryptToken(plain, store) {
    const key = await getOrCreateCryptoKey(store, true);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(plain);
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, data);
    const combined = new Uint8Array(iv.length + ct.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ct), iv.length);
    return bytesToBase64(combined);
}

// base64(IV ‖ ciphertext) → plain. Returns '' on ANY failure (no key, bad blob,
// tampered ciphertext) so callers can treat undecryptable as "signed out".
async function decryptToken(blob, store) {
    try {
        const key = await getOrCreateCryptoKey(store, false);
        if (!key) return '';
        const all = base64ToBytes(blob);
        const iv = all.slice(0, 12);
        const ct = all.slice(12);
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ct);
        return new TextDecoder().decode(pt);
    } catch (_) {
        return '';
    }
}

async function validateAndStorePAT(pat, persistent) {
    const authHeaders = {
        'Authorization': 'Bearer ' + pat,
        'Accept': 'application/vnd.github+json'
    };

    const res = await fetch('https://api.github.com/user', { headers: authHeaders });
    if (!res.ok) throw new Error('Invalid token (' + res.status + ')');
    const user = await res.json();
    // Returned on fine-grained PATs (always) and classic PATs that opted into
    // expiry. Format: "YYYY-MM-DD HH:MM:SS UTC". Header absent = no expiry.
    const expiryHeader = res.headers.get('github-authentication-token-expiration') || '';

    // Real authorization check: a valid token isn't enough — confirm it can
    // actually write to this repo. Without this, non-collaborators would
    // sign in successfully and only hit a confusing 404 at publish time.
    const repoRes = await fetch('https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO, { headers: authHeaders });
    if (!repoRes.ok) {
        throw new Error("This token doesn't have access to " + GITHUB_OWNER + '/' + GITHUB_REPO
            + '. Ask the repo owner to add you as a collaborator.');
    }
    const repo = await repoRes.json();
    if (!repo.permissions || repo.permissions.push !== true) {
        throw new Error("This token doesn't have write access to " + GITHUB_OWNER + '/' + GITHUB_REPO
            + '. Ask the repo owner to add you as a collaborator.');
    }

    // persistent === true (default)  → localStorage   (survives browser restart)
    // persistent === false           → sessionStorage (cleared on browser close)
    const store = persistent === false ? sessionStorage : localStorage;
    const other = persistent === false ? localStorage   : sessionStorage;
    Object.values(LS_KEYS).forEach(function(k) { other.removeItem(k); });
    // Drop any stale key in the target store so encryptToken mints a fresh one
    // bound to this token (avoids reusing a key left from a prior session).
    store.removeItem(LS_KEYS.key);
    store.setItem(LS_KEYS.pat,    await encryptToken(pat, store));
    store.setItem(LS_KEYS.login,  user.login || '');
    store.setItem(LS_KEYS.avatar, user.avatar_url || '');
    store.setItem(LS_KEYS.expiry, expiryHeader);
    // Warm the in-memory cache immediately so the page works without a reload.
    decryptedToken = pat;
    return user;
}

function signOut() {
    Object.values(LS_KEYS).forEach(function(k) {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
    });
    decryptedToken = null;
    // Signing out from the admin page means you're no longer an admin — kick
    // back to the basic page so the gate logic re-applies on next visit.
    if (getPageRole() === 'admin') {
        window.location.replace(PAGE_BASIC_URL);
        return;
    }
    renderAuthUI();
}

// sessionStorage flag set on the admin page just before we kick an
// unauthenticated visitor back to basic. The basic page reads (and clears)
// the flag on load to know it should show the restricted-access modal.
const SS_RESTRICTED_FLAG = 'pg_show_restricted';

function kickToBasicForRestricted() {
    sessionStorage.setItem(SS_RESTRICTED_FLAG, '1');
    window.location.replace(PAGE_BASIC_URL);
}

function showRestrictedModal() {
    const overlay = document.getElementById('restricted-modal-overlay');
    if (overlay) overlay.style.display = 'flex';
}

function hideRestrictedModal() {
    const overlay = document.getElementById('restricted-modal-overlay');
    if (overlay) overlay.style.display = 'none';
}

function renderAuthUI() {
    const chip = document.getElementById('auth-chip');
    if (!chip) return;
    const user = getCurrentUser();
    if (user) {
        chip.innerHTML = '<div class="auth-user">'
            + '<img src="' + authEscape(user.avatar) + '" alt="" class="auth-avatar">'
            + '<span class="auth-login">' + authEscape(user.login) + '</span>'
            + renderExpiryWarning()
            + '<button class="btn-header-action" id="btn-sign-out" title="Sign out">⎋</button>'
            + '</div>';
    } else {
        chip.innerHTML = '<button class="btn-header-action" id="btn-sign-in">🔒 Sign in</button>';
    }
}

// Returns a warning chip when the stored token expires within 7 days (or has
// already expired). Empty string when no expiry is known (classic PATs without
// an expiry date) or when the token has plenty of time left.
function renderExpiryWarning() {
    const raw = getTokenExpiry();
    if (!raw) return '';
    const when = new Date(raw);
    if (isNaN(when.getTime())) return '';
    const msLeft = when.getTime() - Date.now();
    const dayMs = 86400000;
    if (msLeft > 7 * dayMs) return '';
    const tooltip = 'Token expires ' + when.toLocaleString();
    if (msLeft <= 0) {
        return '<span class="auth-expiry-warn" title="' + authEscape(tooltip) + '">⚠ expired</span>';
    }
    const days = Math.max(1, Math.ceil(msLeft / dayMs));
    const label = days === 1 ? '1 day' : days + ' days';
    return '<span class="auth-expiry-warn" title="' + authEscape(tooltip) + '">⚠ expires in ' + label + '</span>';
}

// ─── Modal handling ──────────────────────────────────────────────────────────

function buildGenerateTokenUrl() {
    return 'https://github.com/settings/personal-access-tokens/new'
        + '?target_name=' + encodeURIComponent(GITHUB_OWNER)
        + '&repository_names=' + encodeURIComponent(GITHUB_REPO)
        + '&permissions=contents:write,metadata:read'
        + '&description=Cadre%20Post%20Generator';
}

function openAuthModal() {
    const overlay = document.getElementById('auth-modal-overlay');
    if (!overlay) return;
    document.getElementById('auth-generate-link').href = buildGenerateTokenUrl();
    document.getElementById('auth-pat-input').value = '';
    // Pre-fill the persistence toggle from the user's last saved preference
    // (defaults to ON for first-time sign-in).
    const keepEl = document.getElementById('auth-keep-logged-in');
    if (keepEl) keepEl.checked = readKeepLoggedInPref();
    hideAuthError();
    overlay.style.display = 'flex';
    setTimeout(function() {
        const input = document.getElementById('auth-pat-input');
        if (input) input.focus();
    }, 50);
}

function closeAuthModal() {
    const overlay = document.getElementById('auth-modal-overlay');
    if (overlay) overlay.style.display = 'none';
}

function isAuthModalOpen() {
    const overlay = document.getElementById('auth-modal-overlay');
    return overlay && overlay.style.display === 'flex';
}

function showAuthError(msg) {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = '';
}

function hideAuthError() {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.textContent = '';
    el.style.display = 'none';
}

async function handleSignInSubmit() {
    const input = document.getElementById('auth-pat-input');
    const btn   = document.getElementById('auth-modal-confirm');
    if (!input || !btn) return;
    const pat = input.value.trim();
    if (!pat) { showAuthError('Please paste a token.'); return; }

    // "Keep Me Logged In" checkbox lives in the sign-in modal. Save the user's
    // choice so the next time they sign in (or open Settings) it pre-fills.
    const keepEl = document.getElementById('auth-keep-logged-in');
    const persistent = keepEl ? !!keepEl.checked : true;
    writeKeepLoggedInPref(persistent);

    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = 'Signing in…';
    hideAuthError();

    try {
        await validateAndStorePAT(pat, persistent);
        closeAuthModal();
        // Successful sign-in on the basic (restricted) page promotes the user
        // straight into the admin tool.
        if (getPageRole() === 'basic') {
            window.location.replace(PAGE_ADMIN_URL);
            return;
        }
        renderAuthUI();
    } catch (err) {
        showAuthError(err && err.message ? err.message : 'Sign-in failed.');
    } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
    }
}

// ─── Wiring ──────────────────────────────────────────────────────────────────

// Chip uses event delegation because its inner button is re-rendered on
// sign-in / sign-out — one listener, survives re-renders.
document.getElementById('auth-chip').addEventListener('click', function(e) {
    if (e.target.closest('#btn-sign-in'))  { openAuthModal(); return; }
    if (e.target.closest('#btn-sign-out')) { signOut(); return; }
});

document.getElementById('auth-modal-cancel').addEventListener('click', closeAuthModal);
document.getElementById('auth-modal-confirm').addEventListener('click', handleSignInSubmit);

document.getElementById('auth-modal-overlay').addEventListener('click', function(e) {
    if (e.target === this) closeAuthModal();
});

// Enter submits the form; Esc dismisses the modal.
document.getElementById('auth-pat-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); handleSignInSubmit(); }
});

document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && isAuthModalOpen()) closeAuthModal();
});

// Restricted-access modal lives on the basic page. Close just dismisses it
// (user can keep using the basic editor); Login opens the regular sign-in
// modal so they can promote themselves into admin.
const restrictedClose = document.getElementById('restricted-modal-close');
if (restrictedClose) restrictedClose.addEventListener('click', hideRestrictedModal);

const restrictedLogin = document.getElementById('restricted-modal-login');
if (restrictedLogin) {
    restrictedLogin.addEventListener('click', function() {
        hideRestrictedModal();
        openAuthModal();
    });
}

// ─── Token warm-up ───────────────────────────────────────────────────────────
// Decrypt the on-disk token into the in-memory cache once, at load, BEFORE the
// page-role gate runs. Also performs a one-time migration for users who signed
// in before encryption existed (plaintext pg_pat, no pg_k).
async function warmDecryptToken() {
    const store = localStorage.getItem(LS_KEYS.pat) ? localStorage
                : sessionStorage.getItem(LS_KEYS.pat) ? sessionStorage
                : null;
    if (!store) { decryptedToken = null; return; }

    const blob = store.getItem(LS_KEYS.pat);
    const plain = await decryptToken(blob, store);
    if (plain) { decryptedToken = plain; return; }

    // Decryption failed. If the stored value looks like a raw token, this is a
    // pre-encryption user — adopt it and re-encrypt in place (no re-login).
    if (/^(ghp_|github_pat_|gho_|ghu_|ghs_)/.test(blob)) {
        decryptedToken = blob;
        store.removeItem(LS_KEYS.key);
        try { store.setItem(LS_KEYS.pat, await encryptToken(blob, store)); }
        catch (_) { /* leave plaintext in place rather than lose the session */ }
        return;
    }

    // Genuinely undecryptable (key cleared, tampered) — treat as signed out.
    decryptedToken = null;
}

// ─── Initial page-role gate ──────────────────────────────────────────────────
// Run this BEFORE the first renderAuthUI() so redirects happen without
// flashing the wrong UI state.
function applyPageRoleGate() {
    const role = getPageRole();

    // Signed-in user accidentally hits the basic (gate) URL — bounce up.
    if (role === 'basic' && isAuthenticated()) {
        window.location.replace(PAGE_ADMIN_URL);
        return;
    }

    // Unauthenticated user hits the admin URL — kick them back to basic, and
    // leave a one-shot flag so basic knows to show the restricted-access modal.
    if (role === 'admin' && !isAuthenticated()) {
        kickToBasicForRestricted();
        return;
    }

    // On basic, consume any pending restricted flag set by an admin-side kick.
    if (role === 'basic' && sessionStorage.getItem(SS_RESTRICTED_FLAG) === '1') {
        sessionStorage.removeItem(SS_RESTRICTED_FLAG);
        showRestrictedModal();
    }
}

// ─── Boot ────────────────────────────────────────────────────────────────────
// Warm the in-memory token (async, Web Crypto) BEFORE the gate + first paint so
// redirects and the auth chip reflect the real signed-in state, not a flash.
(async function bootAuth() {
    await warmDecryptToken();
    applyPageRoleGate();
    renderAuthUI();
})();
