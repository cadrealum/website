/* Post Generator tutorial — spotlight coach-marks.

   A self-contained guided tour that dims the screen and highlights one real UI
   element at a time (the actual Save button, Generate button, template sidebar,
   etc.) with a tooltip card and Next / Back / Skip controls.

   - Auto-shows ONCE on a user's first visit, gated by a localStorage flag.
     After finishing or skipping, it never auto-shows again.
   - Admin-only steps are filtered out on the basic page (body[data-page-role]).
   - A "▶ Replay Tutorial" button in the Settings modal calls start() directly.

   Loaded on both post-generator.html and post-generator-admin.html AFTER
   post-gen.js so every target element exists. Exposes:
       window.PostGenTutorial = { start, stop, isDone, reset }

   Styling lives in tools/css/post-gen-tutorial.css. */

(function () {
    'use strict';

    const TUTORIAL_DONE_KEY = 'cadre.postgen.tutorial.done.v1';

    // ─── Persistence (mirrors loadSettings/saveSettings in post-gen.js) ────────
    function isDone() {
        try { return localStorage.getItem(TUTORIAL_DONE_KEY) === '1'; }
        catch (_) { return false; }
    }
    function markDone() {
        try { localStorage.setItem(TUTORIAL_DONE_KEY, '1'); } catch (_) {}
    }
    function reset() {
        try { localStorage.removeItem(TUTORIAL_DONE_KEY); } catch (_) {}
    }

    // ─── Step definitions ──────────────────────────────────────────────────────
    // selector: queried at step time; if missing or hidden the step is skipped.
    // placement: preferred tooltip side; clamped into the viewport as a fallback.
    // adminOnly: shown only when body[data-page-role="admin"].
    const STEPS = [
        {
            selector: null, placement: 'center',
            title: 'Welcome to the Blog Generator',
            body: "This quick tour walks through everything you need to build a blog post — picking a template, adding content, inserting images, and generating the final files. Use Next / Back to move around, or Skip to leave anytime."
        },
        {
            selector: '#template-nav', placement: 'right',
            title: '1 · Pick a Template',
            body: 'Start here. Choose a template on the left and the editor fills with that template’s starting blocks. Switching templates after you’ve added content will ask before replacing your work.'
        },
        {
            selector: '#step-content', placement: 'top',
            title: '2 · Build Your Content',
            body: 'Add content blocks here — paragraphs, section headings, dividers, images, inline YouTube videos, and slideshows. Reorder or remove blocks as you go. The 🤝 Contributors button reveals a sidebar for crediting people.'
        },
        {
            selector: '#btn-open-image-picker', placement: 'bottom',
            title: 'Inserting Images',
            body: 'Browse images stored on the server and drag their paths straight into the editor. The 📁 buttons next to any image field do the same thing for that field. Paths are relative to the site root.'
        },
        {
            selector: '#btn-open-settings', placement: 'bottom',
            title: 'Settings',
            body: 'Tool-wide preferences live here — like showing image folder thumbnails. You can also replay this tutorial from Settings whenever you like.'
        },
        {
            selector: '#btn-save-layout', placement: 'bottom',
            title: 'Save As',
            body: 'Save your work in progress as a JSON draft file you can reload later. Drafts are also autosaved in this browser as you type.'
        },
        {
            selector: '#btn-load-layout', placement: 'bottom',
            title: 'Load',
            body: 'Reopen a saved draft — pick from recent autosaved drafts, or load a JSON file you saved earlier. You can also drag a save file anywhere onto the page.'
        },
        {
            selector: '#btn-generate', placement: 'top',
            title: '3 · Generate',
            body: 'When you’re done, click Generate to produce the post’s HTML file and its blog-data.json entry. Use 👁 Preview first to see exactly how the post will look before generating.'
        },
        {
            selector: '#auth-chip', placement: 'bottom',
            title: 'Sign In',
            body: 'Sign in with a GitHub token to unlock the admin tools — letting you publish posts and manage images directly, without copying files around by hand.'
        },
        // ─── Admin-only steps ───────────────────────────────────────────────────
        {
            selector: '#admin-tools-sidebar', placement: 'left', adminOnly: true,
            title: 'Admin Tools',
            body: 'Signed-in admins get a toolbox on the right: 📁 Image Manager (browse / upload / delete images), Show Changes (review what you’ve staged), Publish Blog (stage the post + JSON entry), Blog List (existing posts), and Blog Index Check (find mismatches). Only one panel opens at a time.'
        },
        {
            selector: '#btn-commit', placement: 'left', adminOnly: true,
            title: 'Commit',
            body: 'Everything you stage with the admin tools is bundled into a single commit. Click 💾 Commit to push it all to GitHub — the live site updates automatically. That’s the whole workflow!'
        }
    ];

    // ─── State ───────────────────────────────────────────────────────────────
    let steps = [];          // filtered STEPS for the current page
    let index = 0;
    let overlay = null;
    let highlight = null;
    let card = null;
    let active = false;

    function isAdminPage() {
        return document.body && document.body.dataset.pageRole === 'admin';
    }

    function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    // ─── DOM build / teardown ──────────────────────────────────────────────────
    function buildDom() {
        overlay = document.createElement('div');
        overlay.className = 'pg-tut-overlay';

        highlight = document.createElement('div');
        highlight.className = 'pg-tut-highlight';
        overlay.appendChild(highlight);

        card = document.createElement('div');
        card.className = 'pg-tut-card';
        overlay.appendChild(card);

        document.body.appendChild(overlay);
    }

    function teardownDom() {
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        overlay = highlight = card = null;
    }

    // ─── Positioning ───────────────────────────────────────────────────────────
    function positionForStep(step) {
        const PAD = 8;        // gap between highlight ring and the real element
        const GAP = 14;       // gap between ring and tooltip card
        const target = step.selector ? document.querySelector(step.selector) : null;

        if (!target || step.placement === 'center') {
            // Centered card, no real target highlighted.
            highlight.classList.add('pg-tut-highlight-center');
            highlight.style.top = '50%';
            highlight.style.left = '50%';
            highlight.style.width = '0px';
            highlight.style.height = '0px';
            card.style.top = '50%';
            card.style.left = '50%';
            card.style.transform = 'translate(-50%, -50%)';
            return;
        }

        highlight.classList.remove('pg-tut-highlight-center');
        card.style.transform = 'none';

        const r = target.getBoundingClientRect();
        const hTop = r.top - PAD, hLeft = r.left - PAD;
        const hW = r.width + PAD * 2, hH = r.height + PAD * 2;
        highlight.style.top = hTop + 'px';
        highlight.style.left = hLeft + 'px';
        highlight.style.width = hW + 'px';
        highlight.style.height = hH + 'px';

        // Measure the card, then place it on the preferred side with viewport clamping.
        const cardRect = card.getBoundingClientRect();
        const cw = cardRect.width, ch = cardRect.height;
        const vw = window.innerWidth, vh = window.innerHeight;
        let placement = step.placement || 'bottom';

        // Flip the placement if there isn't room on the preferred side.
        if (placement === 'bottom' && hTop + hH + GAP + ch > vh) placement = 'top';
        else if (placement === 'top' && hTop - GAP - ch < 0) placement = 'bottom';
        else if (placement === 'right' && hLeft + hW + GAP + cw > vw) placement = 'left';
        else if (placement === 'left' && hLeft - GAP - cw < 0) placement = 'right';

        let top, left;
        switch (placement) {
            case 'top':
                top = hTop - GAP - ch;
                left = hLeft + hW / 2 - cw / 2;
                break;
            case 'left':
                top = hTop + hH / 2 - ch / 2;
                left = hLeft - GAP - cw;
                break;
            case 'right':
                top = hTop + hH / 2 - ch / 2;
                left = hLeft + hW + GAP;
                break;
            case 'bottom':
            default:
                top = hTop + hH + GAP;
                left = hLeft + hW / 2 - cw / 2;
                break;
        }

        // Clamp into the viewport with an 8px margin.
        const M = 8;
        left = Math.max(M, Math.min(left, vw - cw - M));
        top = Math.max(M, Math.min(top, vh - ch - M));
        card.style.top = top + 'px';
        card.style.left = left + 'px';
    }

    // ─── Render the current step ───────────────────────────────────────────────
    function renderStep() {
        const step = steps[index];
        const isLast = index === steps.length - 1;

        const dots = steps.map(function (_, i) {
            return '<span class="pg-tut-dot' + (i === index ? ' pg-tut-dot-active' : '') + '"></span>';
        }).join('');

        card.innerHTML =
            '<button class="pg-tut-close" id="pg-tut-close" title="Close (Esc)" aria-label="Close tutorial">✕</button>' +
            '<div class="pg-tut-title">' + step.title + '</div>' +
            '<div class="pg-tut-body">' + step.body + '</div>' +
            '<div class="pg-tut-dots">' + dots + '</div>' +
            '<div class="pg-tut-actions">' +
                '<button class="pg-tut-btn pg-tut-btn-text" id="pg-tut-skip">Skip</button>' +
                '<span class="pg-tut-spacer"></span>' +
                (index > 0 ? '<button class="pg-tut-btn pg-tut-btn-secondary" id="pg-tut-back">Back</button>' : '') +
                '<button class="pg-tut-btn pg-tut-btn-primary" id="pg-tut-next">' +
                    (isLast ? 'Finish' : 'Next →') +
                '</button>' +
            '</div>';

        card.querySelector('#pg-tut-close').addEventListener('click', finish);
        card.querySelector('#pg-tut-skip').addEventListener('click', finish);
        const backBtn = card.querySelector('#pg-tut-back');
        if (backBtn) backBtn.addEventListener('click', prev);
        card.querySelector('#pg-tut-next').addEventListener('click', next);

        // Scroll the target into view (centered) before measuring, so off-screen
        // elements like Generate / the admin sidebar become visible.
        const step2 = step;
        const target = step2.selector ? document.querySelector(step2.selector) : null;
        if (target) {
            try { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (_) {}
            // Wait a tick for the scroll to settle, then position.
            setTimeout(function () { if (active) positionForStep(step2); }, 200);
        }
        positionForStep(step2);
    }

    // ─── Navigation ────────────────────────────────────────────────────────────
    function next() {
        if (index >= steps.length - 1) { finish(); return; }
        index++;
        renderStep();
    }
    function prev() {
        if (index <= 0) return;
        index--;
        renderStep();
    }
    function finish() {
        markDone();
        stop();
    }

    // ─── Event handlers (bound while active) ────────────────────────────────────
    function onKeydown(e) {
        if (!active) return;
        if (e.key === 'Escape') { e.preventDefault(); finish(); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    }
    function onReflow() {
        if (active && steps[index]) positionForStep(steps[index]);
    }

    // ─── Public API ──────────────────────────────────────────────────────────
    function start() {
        if (active) return;
        // Filter steps for this page, then drop any whose target is missing/hidden
        // (welcome/center steps have no selector and always stay).
        const admin = isAdminPage();
        steps = STEPS.filter(function (s) {
            if (s.adminOnly && !admin) return false;
            if (!s.selector) return true;
            return isVisible(document.querySelector(s.selector));
        });
        if (!steps.length) return;

        active = true;
        index = 0;
        buildDom();
        renderStep();
        document.addEventListener('keydown', onKeydown, true);
        window.addEventListener('resize', onReflow);
        window.addEventListener('scroll', onReflow, true);
    }

    function stop() {
        if (!active) return;
        active = false;
        document.removeEventListener('keydown', onKeydown, true);
        window.removeEventListener('resize', onReflow);
        window.removeEventListener('scroll', onReflow, true);
        teardownDom();
    }

    window.PostGenTutorial = {
        start: start,
        stop: stop,
        isDone: isDone,
        reset: reset
    };

    // ─── Auto-show on first visit ──────────────────────────────────────────────
    if (!isDone()) {
        window.addEventListener('load', function () {
            try { start(); } catch (e) { console.error('PostGenTutorial auto-start', e); }
        });
    }
})();
