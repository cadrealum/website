/* Editor Home (tools/index.html) — landing page for the editor tools.

   The page is viewable WITHOUT signing in. Sign-in lives in the navbar
   (#auth-chip, rendered by auth.js). Behavior per card:
     • Blog Post  → the BASIC generator when signed out (download/copy, no
                    sign-in needed) or the ADMIN generator when signed in.
     • Theme Colors → disabled (grayed) until signed in, since editing the
                      palette commits to the repo; clicking it signed-out opens
                      the sign-in modal.

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

    // Theme Colors → enabled only when signed in.
    const color = document.getElementById('eh-card-color');
    const lock  = document.getElementById('eh-color-lock');
    if (color) color.classList.toggle('eh-card-disabled', !authed);
    if (lock)  lock.style.display = authed ? 'none' : '';
}

// When Theme Colors is locked, intercept the click and open the sign-in modal
// instead of navigating to the (gated) page.
function ehColorClick(e) {
    if (!ehAuthed()) {
        e.preventDefault();
        if (typeof openAuthModal === 'function') openAuthModal();
    }
}

function ehInit() {
    ehRender();

    const chip = document.getElementById('auth-chip');
    if (chip && typeof MutationObserver !== 'undefined') {
        new MutationObserver(ehRender).observe(chip, { childList: true, subtree: true });
    }

    const color = document.getElementById('eh-card-color');
    if (color) color.addEventListener('click', ehColorClick);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ehInit);
} else {
    ehInit();
}
