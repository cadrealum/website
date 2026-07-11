// Rich-text support for the Paragraph block: a thin formatting toolbar over a
// contenteditable editor (bold / italic / underline / link / alignment /
// bullet list), paste that keeps those styles but strips everything else, and
// the converter that turns editor HTML into published blog markup.
//
// Loaded before post-gen-data.js (paragraph renderBody/syncFromDOM/toBodyHtml
// call into here) and before post-gen.js (initEvents calls
// initRichTextEvents). escHtml lives in post-gen.js — referenced only inside
// function bodies, so it resolves at call time.

// ─── Sanitiser ────────────────────────────────────────────────────────────────
//
// Whitelist-based. Everything the editor stores or emits passes through
// richSanitize(): toolbar commands, pasted clipboard HTML, drafts loaded from
// JSON (a draft file is repo content — never trust b.html blindly), and the
// final publish step. Note this is client-side sanitising in a public repo:
// it guards the generated pages and the editor DOM, it is not a server.

// Tag normalisation for the whitelist: key = incoming tagName, value = the tag
// the clean copy uses. Block-ish tags all collapse to <p>. Anything not listed
// (span, font, td, …) is unwrapped — its children survive, the tag doesn't.
const RICH_TAG_MAP = {
    B: 'strong', STRONG: 'strong',
    I: 'em', EM: 'em',
    U: 'u',
    A: 'a', BR: 'br',
    P: 'p', DIV: 'p', CENTER: 'p',
    H1: 'p', H2: 'p', H3: 'p', H4: 'p', H5: 'p', H6: 'p',
    BLOCKQUOTE: 'p', PRE: 'p',
    UL: 'ul', OL: 'ol', LI: 'li'
};

// Tags whose content is junk too — removed wholesale, not unwrapped.
const RICH_DROP_TAGS = {
    SCRIPT: 1, STYLE: 1, HEAD: 1, TITLE: 1, META: 1, LINK: 1, NOSCRIPT: 1,
    IFRAME: 1, OBJECT: 1, EMBED: 1, SVG: 1, MATH: 1, TEMPLATE: 1,
    IMG: 1, PICTURE: 1, VIDEO: 1, AUDIO: 1, CANVAS: 1,
    BUTTON: 1, INPUT: 1, SELECT: 1, TEXTAREA: 1, FORM: 1
};

const RICH_BLOCK_TAGS = { p: 1, ul: 1, ol: 1, li: 1 };

function richSafeHref(raw) {
    const url = String(raw || '').trim();
    if (!url) return '';
    if (/^(https?:|mailto:|tel:)/i.test(url)) return url;
    if (/^[a-z][a-z0-9+.\-]*:/i.test(url)) return '';   // any other scheme (javascript:, data:, …)
    return url;                                          // relative path or #anchor
}

function richTextAlign(el) {
    if (el.tagName === 'CENTER') return 'center';
    const v = (el.style.textAlign || el.getAttribute('align') || '').toLowerCase();
    return /^(left|center|right|justify)$/.test(v) ? v : '';
}

// Formatting that pasted content (Word / Google Docs) expresses as inline
// styles rather than real tags. Returns the tags to re-wrap the children in.
function richStyleWrappers(el) {
    const st = el.style, out = [];
    if (st.fontWeight === 'bold' || st.fontWeight === 'bolder' || parseInt(st.fontWeight, 10) >= 600) out.push('strong');
    if (st.fontStyle === 'italic' || st.fontStyle === 'oblique') out.push('em');
    if ((st.textDecoration + ' ' + st.textDecorationLine).indexOf('underline') !== -1) out.push('u');
    return out;
}

function richCleanChildren(parent) {
    Array.prototype.slice.call(parent.childNodes).forEach(function(node) {
        if (node.nodeType === 3) return;                            // text — keep
        // toUpperCase: foreign elements (svg, math) keep lowercase tagNames.
        const tagName = node.nodeType === 1 ? node.tagName.toUpperCase() : '';
        if (node.nodeType !== 1 || RICH_DROP_TAGS[tagName]) {       // comments, junk
            parent.removeChild(node);
            return;
        }

        richCleanChildren(node);   // depth-first so this node sees clean children

        let tag = RICH_TAG_MAP[tagName] || '';
        // Google Docs wraps the whole clipboard in <b style="font-weight:normal">.
        if (tag === 'strong' && /^(normal|400)$/.test(node.style.fontWeight)) tag = '';
        // A block that still contains blocks (nested divs → p) can't become a
        // <p>; unwrap it and let its children stand on their own.
        if (tag === 'p' && node.querySelector('p, ul, ol, li')) tag = '';
        // An <li> outside a list would end up inline inside a <p> downstream.
        if (tag === 'li' && !(parent.tagName === 'UL' || parent.tagName === 'OL')) tag = '';

        let out, inner;
        if (tag) {
            out = document.createElement(tag);
            if (tag === 'a') {
                const href = richSafeHref(node.getAttribute('href'));
                if (href) out.setAttribute('href', href);
            }
            inner = out;
            if (RICH_BLOCK_TAGS[tag]) {
                const align = richTextAlign(node);
                if (align) out.style.textAlign = align;
                // e.g. Word's <p style="font-weight:bold"> — keep the styling
                // by wrapping the paragraph's children in real tags.
                richStyleWrappers(node).forEach(function(w) {
                    inner = inner.appendChild(document.createElement(w));
                });
            }
        } else {
            out = document.createDocumentFragment();
            inner = out;
            // Re-express style-based formatting (spans) as real tags before
            // the element itself is unwrapped.
            richStyleWrappers(node).forEach(function(w) {
                inner = inner.appendChild(document.createElement(w));
            });
        }
        while (node.firstChild) inner.appendChild(node.firstChild);
        parent.replaceChild(out, node);
    });
}

function richSanitize(html) {
    const root = document.createElement('div');
    root.innerHTML = String(html || '');
    richCleanChildren(root);
    return root.innerHTML;
}

function richIsEmpty(html) {
    const d = document.createElement('div');
    d.innerHTML = String(html || '');
    return !d.textContent.trim();
}

// ─── Published-HTML converter ─────────────────────────────────────────────────
// Turns stored editor HTML into blog markup: loose inline runs get wrapped in
// <p>, real blocks are emitted as-is (lists pretty-printed, one <li> per
// line), and empty paragraphs are dropped — .blog-body margins handle spacing.

function richToBlogHtml(html, px) {
    const root = document.createElement('div');
    root.innerHTML = richSanitize(html);

    const lines = [];
    let run = document.createElement('p');   // collects loose inline nodes

    function flushRun() {
        if (run.textContent.trim()) lines.push(px + '<p>' + run.innerHTML + '</p>');
        run = document.createElement('p');
    }

    Array.prototype.slice.call(root.childNodes).forEach(function(node) {
        const tag = node.nodeType === 1 ? node.tagName : '';
        if (tag === 'P') {
            flushRun();
            if (node.textContent.trim()) lines.push(px + node.outerHTML);
        } else if (tag === 'UL' || tag === 'OL') {
            flushRun();
            const t = tag.toLowerCase();
            lines.push(px + '<' + t + '>');
            Array.prototype.forEach.call(node.children, function(li) {
                lines.push(px + '    ' + li.outerHTML);
            });
            lines.push(px + '</' + t + '>');
        } else {
            run.appendChild(node);   // safe: iterating a static copy
        }
    });
    flushRun();

    return lines.length ? lines.join('\n') : px + '<p></p>';
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function richToolbarHtml() {
    function btn(cmd, title, inner) {
        return '<button type="button" class="rich-btn" data-rich-cmd="' + cmd
            + '" title="' + title + '" aria-label="' + title + '">' + inner + '</button>';
    }
    function svg(inner) {
        return '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"'
            + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
    }
    const sep = '<span class="rich-sep" aria-hidden="true"></span>';

    const icoLink = svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>'
        + '<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>');
    const icoLeft   = svg('<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/>');
    const icoCenter = svg('<line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>');
    const icoRight  = svg('<line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/>');
    const icoList   = svg('<line x1="9" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="9" y1="18" x2="21" y2="18"/>'
        + '<circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>');

    return '<div class="rich-toolbar" role="toolbar" aria-label="Text formatting">'
        + btn('bold',      'Bold (Ctrl+B)',      '<span class="rich-glyph rich-glyph-bold">B</span>')
        + btn('italic',    'Italic (Ctrl+I)',    '<span class="rich-glyph rich-glyph-italic">I</span>')
        + btn('underline', 'Underline (Ctrl+U)', '<span class="rich-glyph rich-glyph-underline">U</span>')
        + sep
        + btn('link', 'Insert link (Ctrl+K)', icoLink)
        + sep
        + btn('justifyLeft',   'Align left',   icoLeft)
        + btn('justifyCenter', 'Align center', icoCenter)
        + btn('justifyRight',  'Align right',  icoRight)
        + sep
        + btn('insertUnorderedList', 'Bulleted list', icoList)
        + '</div>';
}

function richUpdateToolbarState(editor) {
    const wrap = editor.closest('.rich-text-wrap');
    if (!wrap) return;
    wrap.querySelectorAll('[data-rich-cmd]').forEach(function(btn) {
        const cmd = btn.dataset.richCmd;
        let on = false;
        if (cmd === 'link') {
            on = !!richClosestAnchor(editor);
        } else {
            try { on = document.queryCommandState(cmd); } catch (_) {}
        }
        btn.classList.toggle('is-active', on);
    });
}

// ─── Link insert / edit / remove ──────────────────────────────────────────────

function richClosestAnchor(editor) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    let n = sel.getRangeAt(0).commonAncestorContainer;
    if (n.nodeType === 3) n = n.parentNode;
    const a = n && n.closest ? n.closest('a') : null;
    return a && editor.contains(a) ? a : null;
}

function richLinkFlow(editor) {
    const sel = window.getSelection();
    if (!sel.rangeCount || !editor.contains(sel.anchorNode)) return;
    const anchor = richClosestAnchor(editor);
    const saved = sel.getRangeAt(0).cloneRange();   // prompt() steals focus

    let url = window.prompt(
        anchor ? 'Edit link URL (leave empty to remove the link):' : 'Link URL:',
        anchor ? (anchor.getAttribute('href') || '') : 'https://');
    if (url === null) return;   // cancelled
    url = url.trim();

    editor.focus();
    sel.removeAllRanges();
    sel.addRange(saved);

    if (!url) {
        if (anchor) {
            const r = document.createRange();
            r.selectNodeContents(anchor);
            sel.removeAllRanges();
            sel.addRange(r);
            document.execCommand('unlink', false, null);
        }
        return;
    }

    const safe = richSafeHref(url);
    if (!safe) {
        alert('That link type is not allowed. Use an http(s), mailto:, or relative URL.');
        return;
    }

    if (anchor) {
        anchor.setAttribute('href', safe);   // retarget in place; keeps the text
    } else if (sel.isCollapsed) {
        // Nothing selected — insert the URL itself as the link text.
        document.execCommand('insertHTML', false, '<a href="' + escHtml(safe) + '">' + escHtml(safe) + '</a>');
    } else {
        document.execCommand('createLink', false, safe);
    }
}

// ─── Event wiring ─────────────────────────────────────────────────────────────
// One set of delegated listeners on the content builder; editors and toolbars
// are re-rendered wholesale by renderContentBuilder, so nothing binds per-block.

function initRichTextEvents(builder) {
    // Enter should produce <p> (not <div>) so editor content matches output.
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (_) {}

    // A mousedown on a toolbar button would move focus and collapse the
    // editor's selection before the click lands — suppress it.
    builder.addEventListener('mousedown', function(e) {
        if (e.target.closest('.rich-btn')) e.preventDefault();
    });

    builder.addEventListener('click', function(e) {
        const btn = e.target.closest('[data-rich-cmd]');
        if (!btn) return;
        const wrap = btn.closest('.rich-text-wrap');
        const editor = wrap && wrap.querySelector('.rich-editor');
        if (!editor) return;
        editor.focus();
        const cmd = btn.dataset.richCmd;
        if (cmd === 'link') {
            richLinkFlow(editor);
        } else {
            document.execCommand(cmd, false, null);
        }
        richUpdateToolbarState(editor);
    });

    // Intercept paste so bold/italic/underline/links/lists survive but junk
    // (fonts, colors, spans, classes, images) doesn't.
    builder.addEventListener('paste', function(e) {
        const ed = e.target.closest('.rich-editor');
        if (!ed || !e.clipboardData) return;
        e.preventDefault();
        const clean = richSanitize(e.clipboardData.getData('text/html'));
        if (!richIsEmpty(clean)) {
            document.execCommand('insertHTML', false, clean);
        } else {
            const txt = e.clipboardData.getData('text/plain');
            document.execCommand('insertHTML', false, escHtml(txt).replace(/\r\n?|\n/g, '<br>'));
        }
    });

    builder.addEventListener('keydown', function(e) {
        const ed = e.target.closest('.rich-editor');
        if (!ed) return;
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
            e.preventDefault();
            richLinkFlow(ed);
        }
    });

    // Keep the toolbar's pressed states in sync with wherever the caret is.
    document.addEventListener('selectionchange', function() {
        const active = document.activeElement;
        if (active && active.classList && active.classList.contains('rich-editor')) {
            richUpdateToolbarState(active);
        }
    });
}
