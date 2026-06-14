/* Editor Home (tools/index.html) — landing page for the editor tools.

   The page is viewable WITHOUT signing in. Sign-in lives in the navbar
   (#auth-chip, rendered by auth.js). Behavior per card:
     • Blog Post  → the BASIC generator when signed out (download/copy, no
                    sign-in needed) or the ADMIN generator when signed in.
     • Theme Colors → usable signed out too: the color picker has a restricted
                      view (browse, edit, preview, save-to-computer) and locks
                      only the repo writes. The card just shows a "sign in to
                      save changes" hint while signed out.

   We re-evaluate on every auth change via a MutationObserver on #auth-chip
   (auth.js re-renders the chip on sign in / out) — no auth.js changes.

   Loaded after post-gen-modals.js (sign-in modal) and AuthManager/auth.js
   (isAuthenticated, openAuthModal). */

function ehAuthed() {
    return (typeof isAuthenticated === 'function') && isAuthenticated();
}

function ehRender() {
    const authed = ehAuthed();

    // Blog Post → admin generator (commit-capable) when signed in, basic
    // generator (no sign-in required) otherwise.
    const blog = document.getElementById('eh-card-blog');
    if (blog) blog.setAttribute('href', authed ? 'post-generator-admin.html' : 'post-generator.html');

    // Theme Colors → always navigable; signed-out users get the restricted view.
    // The lock chip becomes a "sign in to save changes" hint while signed out.
    const lock = document.getElementById('eh-color-lock');
    if (lock) lock.style.display = authed ? 'none' : '';
}

function ehInit() {
    ehRender();

    const chip = document.getElementById('auth-chip');
    if (chip && typeof MutationObserver !== 'undefined') {
        new MutationObserver(ehRender).observe(chip, { childList: true, subtree: true });
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ehInit);
} else {
    ehInit();
}
