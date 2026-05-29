// Editor UI, event handling, save/load, and init for the post generator.
// State, constants, and the BLOCK_TYPES registry live in post-gen-data.js.
// HTML/JSON output lives in post-gen-output.js.

// ─── Utilities ────────────────────────────────────────────────────────────────

function escJson(str) {
    return String(str || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '');
}

function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatDisplayDate(val) {
    if (!val) return '';
    const [y, m, d] = val.split('-').map(Number);
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    return months[m - 1] + ' ' + d + ', ' + y;
}

function formatJsonDate(val) {
    if (!val) return '';
    const [y, m, d] = val.split('-');
    return m + '-' + d + '-' + y;
}

function slugify(str) {
    return String(str || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .substring(0, 60) || '';
}

function extractYouTubeId(url) {
    const m = String(url || '').match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : '';
}

async function copyToClipboard(text, btn) {
    const orig = btn.textContent;
    try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied!';
    } catch (err) {
        btn.textContent = 'Copy failed';
        console.warn('Clipboard write failed:', err);
    }
    setTimeout(function() { btn.textContent = orig; }, 2000);
}

function getVal(id) { return (document.getElementById(id) || {}).value || ''; }

function hasBlocks() { return state.blocks.length > 0 || state.contributors.length > 0; }

function getFilename() {
    const raw = (els.fFilename ? els.fFilename.value : '').trim();
    const slug = slugify(raw);
    return (slug || 'untitled-blog-post') + '.html';
}

function setDefaultDate() {
    const d = new Date();
    const iso = d.getFullYear() + '-'
        + String(d.getMonth() + 1).padStart(2, '0') + '-'
        + String(d.getDate()).padStart(2, '0');
    els.fDate.value = iso;
}

// ─── DOM element cache ────────────────────────────────────────────────────────
// Populated once at the bottom-of-file init. Every later DOM access goes via
// `els` so we never query the same id twice per session.

const els = {};

function initElementCache() {
    els.templateNav        = document.getElementById('template-nav');
    els.contentBuilder     = document.getElementById('content-builder');
    els.contribSidebar     = document.getElementById('contrib-sidebar');
    els.contentContribRow  = document.getElementById('content-contrib-row');
    els.btnContribToggle   = document.getElementById('btn-contrib-toggle');
    els.outputSection      = document.getElementById('output-section');
    els.outHtml            = document.getElementById('out-html');
    els.outJson            = document.getElementById('out-json');
    els.fTitle             = document.getElementById('f-title');
    els.fAuthor            = document.getElementById('f-author');
    els.fDate              = document.getElementById('f-date');
    els.fEndDate           = document.getElementById('f-end-date');
    els.fEndDateField      = document.getElementById('field-end-date');
    els.fThumbnail         = document.getElementById('f-thumbnail');
    els.fFilename          = document.getElementById('f-filename');
    els.btnSave            = document.getElementById('btn-save-layout');
    els.modalOverlay       = document.getElementById('modal-overlay');
    els.clearModalOverlay  = document.getElementById('clear-modal-overlay');
    els.dropOverlay        = document.getElementById('drop-overlay');
    els.previewOverlay     = document.getElementById('preview-overlay');
    els.previewIframe      = document.getElementById('preview-iframe');
    els.importFile         = document.getElementById('import-file');
}

// ─── Data loading ─────────────────────────────────────────────────────────────

function stripLiveServerInjection(html) {
    return html.replace(/\s*<!-- Code injected by live-server -->[\s\S]*?<\/script>\s*/gi, '\n');
}

function loadTemplates() {
    fetch('json/template-data.json')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            templates       = data.templates       || BLANK_TEMPLATE_FALLBACK;
            socialPlatforms = data.socialPlatforms || SOCIAL_PLATFORMS_FALLBACK;
            renderTemplateNav();
            applyTemplate('blank');
        })
        .catch(function() {
            templates       = BLANK_TEMPLATE_FALLBACK;
            socialPlatforms = SOCIAL_PLATFORMS_FALLBACK;
            renderTemplateNav();
            applyTemplate('blank');
        });
}

function loadBaseTemplate() {
    fetch('../Announcements-Blogs/base-template.html')
        .then(function(r) { return r.text(); })
        .then(function(text) { baseTemplate = stripLiveServerInjection(text); })
        .catch(function() { baseTemplate = null; /* buildFullHTML alerts the user */ });
}

// ─── Template Nav & Selection ─────────────────────────────────────────────────

function renderTemplateNav() {
    let html = '';
    templates.forEach(function(tpl) {
        const sel = tpl.id === state.templateId ? ' selected' : '';
        html += '<button class="tpl-btn' + sel + '" data-tpl-id="' + tpl.id + '">'
            + '<span class="tpl-icon">' + tpl.icon + '</span>'
            + '<span class="tpl-info"><span class="tpl-name">' + escHtml(tpl.name) + '</span>'
            + '<span class="tpl-desc">' + escHtml(tpl.desc) + '</span></span></button>';
    });
    els.templateNav.innerHTML = html;
}

function initTemplateNavEvents() {
    els.templateNav.addEventListener('click', function(e) {
        const btn = e.target.closest('[data-tpl-id]');
        if (!btn) return;
        const tplId = btn.dataset.tplId;
        if (tplId === state.templateId) return;
        if (hasBlocks()) { state.pendingTemplate = tplId; showModal(); }
        else { applyTemplate(tplId); }
    });
}

function applyTemplate(tplId) {
    const tpl = templates.find(function(t) { return t.id === tplId; });
    if (!tpl) return;
    state.templateId = tplId;
    state.settings = Object.assign({ isEvent: false, hasSlideshowCss: false, showContributors: false }, tpl.settings);
    state.blocks = JSON.parse(JSON.stringify(tpl.blocks || []));
    state.contributors = JSON.parse(JSON.stringify(tpl.contributors || []));
    state.showContributors = !!tpl.settings.showContributors;
    filenameAutoFill = true;
    updateDetailsFields();
    updateContribSidebarVisibility();
    renderTemplateNav();
    renderContentBuilder();
    if (state.showContributors) renderContribSidebar();
    updateSaveButtonState();
    clearOutput();
}

function updateDetailsFields() {
    els.fEndDateField.style.display = state.settings.isEvent ? '' : 'none';
}

// ─── Editor chrome ────────────────────────────────────────────────────────────

function updateContribSidebarVisibility() {
    els.contribSidebar.style.display = state.showContributors ? '' : 'none';
    els.btnContribToggle.classList.toggle('active', state.showContributors);
    els.contentContribRow.classList.toggle('contrib-open', state.showContributors);
}

function updateSaveButtonState() {
    els.btnSave.disabled = !hasBlocks();
}

function clearOutput() {
    els.outputSection.classList.remove('visible');
    if (els.outHtml) els.outHtml.value = '';
    if (els.outJson) els.outJson.value = '';
}

// ─── Contributors Sidebar ─────────────────────────────────────────────────────

function renderContribSidebar() {
    let html = '<div class="contrib-sidebar-title">Contributors Sidebar</div>';
    state.contributors.forEach(function(c, i) { html += renderContributor(c, i); });
    html += '<div class="add-block-bar" style="margin-top:8px"><button class="btn-add" id="btn-add-contrib" style="width:100%">+ Add Contributor</button></div>';
    els.contribSidebar.innerHTML = html;
    updateSaveButtonState();
}

function renderContributor(c, i) {
    const isFirst = i === 0, isLast = i === state.contributors.length - 1;
    const socialsHtml = (c.socials || []).map(function(s, si) {
        const opts = socialPlatforms.map(function(p) {
            return '<option value="' + p.value + '"' + (s.platform === p.value ? ' selected' : '') + '>' + p.label + '</option>';
        }).join('');
        return '<div class="social-item" data-social-idx="' + si + '">'
            + '<select data-sf="platform">' + opts + '</select>'
            + '<input type="url" data-sf="url" value="' + escHtml(s.url) + '" placeholder="URL…">'
            + '<button class="btn-icon danger" data-remove-social="' + si + '" title="Remove">✕</button>'
            + '</div>';
    }).join('');

    return '<div class="contrib-item" data-contrib-idx="' + i + '">'
        + '<div class="contrib-item-header">Contributor ' + (i + 1)
        + '<div class="controls">'
        + '<button class="btn-icon" data-contrib-up="' + i + '"' + (isFirst ? ' disabled' : '') + '>↑</button>'
        + '<button class="btn-icon" data-contrib-down="' + i + '"' + (isLast ? ' disabled' : '') + '>↓</button>'
        + '<button class="btn-icon danger" data-contrib-remove="' + i + '">✕</button>'
        + '</div></div>'
        + '<div class="contrib-item-body">'
        + '<div class="field"><label>Name</label><input type="text" data-cf="name" value="' + escHtml(c.name) + '" placeholder="Full name"></div>'
        + '<div class="field"><label>Photo Path</label>'
        +   '<div class="img-input-row">'
        +     '<input type="text" data-cf="photo" value="' + escHtml(c.photo) + '" placeholder="images/people/jane.jpg">'
        +     '<button type="button" class="btn-pick-image" data-pick-image-for="contrib-photo" title="Pick an image from the server">📁</button>'
        +   '</div>'
        + '</div>'
        + '<div class="field"><label>Social Links</label>'
        + '<div class="social-list">' + socialsHtml + '</div>'
        + '<button class="btn-add" data-add-social="' + i + '" style="margin-top:6px;width:100%;font-size:12px;padding:5px 10px">+ Add Social</button>'
        + '</div>'
        + '</div></div>';
}

function syncContributorsFromDOM() {
    document.querySelectorAll('[data-contrib-idx]').forEach(function(el) {
        const i = Number(el.dataset.contribIdx);
        const c = state.contributors[i];
        if (!c) return;
        const nameInp = el.querySelector('[data-cf="name"]');
        if (nameInp) c.name = nameInp.value;
        const photoInp = el.querySelector('[data-cf="photo"]');
        if (photoInp) c.photo = photoInp.value;
        c.socials = [];
        el.querySelectorAll('[data-social-idx]').forEach(function(sEl) {
            const platform = (sEl.querySelector('[data-sf="platform"]') || {}).value || 'other';
            const url = (sEl.querySelector('[data-sf="url"]') || {}).value || '';
            c.socials.push({ platform: platform, url: url });
        });
    });
}

// ─── Content Builder ──────────────────────────────────────────────────────────

function renderContentBuilder() {
    if (!state.templateId) {
        els.contentBuilder.innerHTML = '<div class="placeholder-prompt">Select a template on the left to start writing.</div>';
        return;
    }

    let html = '<div class="block-list" id="block-list">';
    state.blocks.forEach(function(b, i) { html += renderBlock(b, i); });
    html += '</div>';

    html += '<div class="add-block-bar">';
    Object.keys(BLOCK_TYPES).forEach(function(type) {
        html += '<button class="btn-add" data-add="' + type + '">+ ' + BLOCK_TYPES[type].label + '</button>';
    });
    html += '</div>';

    els.contentBuilder.innerHTML = html;
    updateSaveButtonState();
}

function renderBlock(b, i) {
    const isFirst = i === 0, isLast = i === state.blocks.length - 1;
    const def = BLOCK_TYPES[b.type];
    if (!def) return ''; // unknown block type

    const colAClass = 'btn-icon btn-col-toggle' + (b.col === 'A' ? ' col-active-a' : '');
    const colBClass = 'btn-icon btn-col-toggle' + (b.col === 'B' ? ' col-active-b' : '');
    const colBadge  = b.col ? '<span class="col-badge col-' + b.col.toLowerCase() + '">Col ' + b.col + '</span>' : '';
    const badgeCls  = 'block-type-badge' + (def.badgeClass ? ' ' + def.badgeClass : '');
    const badge     = '<span class="' + badgeCls + '">' + def.label + '</span>';

    return '<div class="block-item" data-block-idx="' + i + '" draggable="true">'
        + '<div class="block-header">' + badge + colBadge
        + '<span class="drag-handle" title="Drag to reorder"></span>'
        + '<div class="block-controls">'
        + '<button class="' + colAClass + '" data-set-col-a="' + i + '" title="Assign to Column A">A</button>'
        + '<button class="' + colBClass + '" data-set-col-b="' + i + '" title="Assign to Column B">B</button>'
        + '<button class="btn-icon" data-move-up="' + i + '" title="Move up"' + (isFirst ? ' disabled' : '') + '>↑</button>'
        + '<button class="btn-icon" data-move-down="' + i + '" title="Move down"' + (isLast ? ' disabled' : '') + '>↓</button>'
        + '<button class="btn-icon danger" data-remove-block="' + i + '" title="Remove">✕</button>'
        + '</div></div>'
        + '<div class="block-body">' + def.renderBody(b) + '</div>'
        + '</div>';
}

function syncBlocksFromDOM() {
    document.querySelectorAll('[data-block-idx]').forEach(function(blockEl) {
        const i = Number(blockEl.dataset.blockIdx);
        const b = state.blocks[i];
        if (!b) return;
        const def = BLOCK_TYPES[b.type];
        if (def) def.syncFromDOM(b, blockEl);
    });
}

// ─── Block list events ────────────────────────────────────────────────────────
// Strategy: one click handler. Sync DOM → state ONCE up front, then dispatch
// to a per-arm helper. No per-arm sync calls littered through the handler.

function initBlockToolbarEvents(builder) {
    builder.addEventListener('click', function(e) {
        const t = e.target;
        // Probe every supported arm. `data-add-slide` overlaps `data-add`,
        // so resolve slideshow buttons first.
        const slideAdd    = t.closest('[data-add-slide]');
        const slideRemove = t.closest('[data-remove-slide]');
        const addBtn      = slideAdd ? null : t.closest('[data-add]');
        const removeBtn   = t.closest('[data-remove-block]');
        const upBtn       = t.closest('[data-move-up]');
        const downBtn     = t.closest('[data-move-down]');
        const colABtn     = t.closest('[data-set-col-a]');
        const colBBtn     = t.closest('[data-set-col-b]');

        if (!addBtn && !removeBtn && !upBtn && !downBtn && !colABtn && !colBBtn && !slideAdd && !slideRemove) return;

        // One sync up front — handlers below just mutate state.
        syncBlocksFromDOM();

        if (addBtn) {
            const def = BLOCK_TYPES[addBtn.dataset.add];
            if (!def) return;
            state.blocks.push(def.defaults());
            clearOutput();
        } else if (removeBtn) {
            state.blocks.splice(Number(removeBtn.dataset.removeBlock), 1);
            clearOutput();
        } else if (upBtn) {
            const n = Number(upBtn.dataset.moveUp);
            if (n <= 0) return;
            const tmp = state.blocks[n - 1];
            state.blocks[n - 1] = state.blocks[n];
            state.blocks[n] = tmp;
        } else if (downBtn) {
            const n = Number(downBtn.dataset.moveDown);
            if (n >= state.blocks.length - 1) return;
            const tmp = state.blocks[n + 1];
            state.blocks[n + 1] = state.blocks[n];
            state.blocks[n] = tmp;
        } else if (colABtn) {
            const n = Number(colABtn.dataset.setColA);
            state.blocks[n].col = state.blocks[n].col === 'A' ? null : 'A';
        } else if (colBBtn) {
            const n = Number(colBBtn.dataset.setColB);
            state.blocks[n].col = state.blocks[n].col === 'B' ? null : 'B';
        } else if (slideAdd) {
            const bi = Number(slideAdd.closest('[data-block-idx]').dataset.blockIdx);
            state.blocks[bi].slides.push({ url: '', alt: '' });
        } else if (slideRemove) {
            const bi = Number(slideRemove.closest('[data-block-idx]').dataset.blockIdx);
            state.blocks[bi].slides.splice(Number(slideRemove.dataset.removeSlide), 1);
            // Slideshow needs at least one slide to render.
            if (state.blocks[bi].slides.length === 0) {
                state.blocks[bi].slides.push({ url: '', alt: '' });
            }
        }

        renderContentBuilder();
    });
}

function initBlockDragReorder(builder) {
    let dragSrcIndex = null;
    let mouseDownEl  = null;

    function clearDropIndicators() {
        builder.querySelectorAll('.drop-target-before, .drop-target-after')
            .forEach(function(el) { el.classList.remove('drop-target-before', 'drop-target-after'); });
    }

    // dragstart's e.target is the draggable .block-item, not the actual
    // mousedown target. Tracking mousedown separately lets us tell whether
    // the drag started from the drag handle vs an input/button inside the block.
    builder.addEventListener('mousedown', function(e) { mouseDownEl = e.target; });

    builder.addEventListener('dragstart', function(e) {
        const blockEl = e.target.closest('[data-block-idx]');
        if (!blockEl) return;
        if (!mouseDownEl || !mouseDownEl.closest('.drag-handle')) {
            e.preventDefault(); return;
        }
        dragSrcIndex = Number(blockEl.dataset.blockIdx);
        blockEl.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(dragSrcIndex)); } catch (_) {}
        syncBlocksFromDOM();
    });

    builder.addEventListener('dragend', function(e) {
        const blockEl = e.target.closest('[data-block-idx]');
        if (blockEl) blockEl.classList.remove('dragging');
        clearDropIndicators();
        dragSrcIndex = null;
    });

    builder.addEventListener('dragover', function(e) {
        if (dragSrcIndex === null) return;
        const blockEl = e.target.closest('[data-block-idx]');
        if (!blockEl) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = blockEl.getBoundingClientRect();
        const dropAfter = (e.clientY - rect.top) > rect.height / 2;
        clearDropIndicators();
        blockEl.classList.add(dropAfter ? 'drop-target-after' : 'drop-target-before');
    });

    builder.addEventListener('dragleave', function(e) {
        if (dragSrcIndex === null) return;
        if (!builder.contains(e.relatedTarget)) clearDropIndicators();
    });

    builder.addEventListener('drop', function(e) {
        if (dragSrcIndex === null) return;
        e.preventDefault();
        const blockEl = e.target.closest('[data-block-idx]');
        clearDropIndicators();
        if (!blockEl) { dragSrcIndex = null; return; }
        let targetIndex = Number(blockEl.dataset.blockIdx);
        const rect = blockEl.getBoundingClientRect();
        const dropAfter = (e.clientY - rect.top) > rect.height / 2;
        if (dropAfter) targetIndex++;
        if (dragSrcIndex < targetIndex) targetIndex--;
        if (targetIndex !== dragSrcIndex) {
            const moved = state.blocks.splice(dragSrcIndex, 1)[0];
            state.blocks.splice(targetIndex, 0, moved);
            renderContentBuilder();
            clearOutput();
        }
        dragSrcIndex = null;
    });
}

function initEvents() {
    initBlockToolbarEvents(els.contentBuilder);
    initBlockDragReorder(els.contentBuilder);
}

// ─── Image-picker buttons ─────────────────────────────────────────────────────
// Every image-path input renders a small 📁 button next to it. Clicking
// dispatches to whichever image-tooling module is on the page:
//   - basic page : window.ImagePicker (read-only browser)
//   - admin page : window.ImageManager (full management; can upload too)
// Both expose openInPickMode(callback), isOpen(), close() — see those files.

function findInputForPickButton(btn) {
    const row = btn.closest('.img-input-row, .slide-item');
    if (!row) return null;
    return row.querySelector('input[type="text"]');
}

// Which button (if any) currently has the picker open in its name.
let activePickBtn = null;
function setActivePickBtn(btn) {
    if (activePickBtn && activePickBtn !== btn) activePickBtn.classList.remove('btn-pick-image-active');
    activePickBtn = btn || null;
    if (activePickBtn) activePickBtn.classList.add('btn-pick-image-active');
}
function clearActivePickBtn() {
    if (activePickBtn) activePickBtn.classList.remove('btn-pick-image-active');
    activePickBtn = null;
}

function initImagePickerButtons() {
    document.addEventListener('click', function(e) {
        const btn = e.target.closest('.btn-pick-image');
        if (!btn) return;
        const picker = window.ImageManager || window.ImagePicker;
        if (!picker || typeof picker.openInPickMode !== 'function') {
            alert('Image picker is not available on this page.');
            return;
        }
        // Toggle: clicking the SAME pick button again closes the modal. Clicking
        // a DIFFERENT pick button while one is active just swaps the target —
        // openInPickMode overwrites the previous callback in the picker module.
        if (activePickBtn === btn) {
            if (typeof picker.close === 'function') picker.close();
            clearActivePickBtn();
            return;
        }
        const input = findInputForPickButton(btn);
        if (!input) return;
        setActivePickBtn(btn);
        picker.openInPickMode(function(path) {
            clearActivePickBtn();
            if (path == null) return;       // user cancelled / closed
            input.value = path;
            input.dispatchEvent(new Event('input',  { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            // Update model so the next renderContentBuilder doesn't wipe the
            // newly-picked value back to '' (renderContentBuilder reads from
            // state, not the DOM).
            syncBlocksFromDOM();
            syncContributorsFromDOM();
        });
    });
}

function initContribEvents() {
    els.btnContribToggle.addEventListener('click', function() {
        syncContributorsFromDOM();
        state.showContributors = !state.showContributors;
        updateContribSidebarVisibility();
        if (state.showContributors) renderContribSidebar();
    });

    els.contribSidebar.addEventListener('click', function(e) {
        const t = e.target;
        const addContrib   = (t.id === 'btn-add-contrib') ? t : null;
        const upBtn        = t.closest('[data-contrib-up]');
        const downBtn      = t.closest('[data-contrib-down]');
        const removeBtn    = t.closest('[data-contrib-remove]');
        const addSocial    = t.closest('[data-add-social]');
        const removeSocial = t.closest('[data-remove-social]');

        if (!addContrib && !upBtn && !downBtn && !removeBtn && !addSocial && !removeSocial) return;

        // One sync up front — handlers below just mutate state.
        syncContributorsFromDOM();

        if (addContrib) {
            state.contributors.push({ name: '', photo: '', socials: [] });
        } else if (upBtn) {
            const n = Number(upBtn.dataset.contribUp);
            if (n <= 0) return;
            const tmp = state.contributors[n - 1];
            state.contributors[n - 1] = state.contributors[n];
            state.contributors[n] = tmp;
        } else if (downBtn) {
            const n = Number(downBtn.dataset.contribDown);
            if (n >= state.contributors.length - 1) return;
            const tmp = state.contributors[n + 1];
            state.contributors[n + 1] = state.contributors[n];
            state.contributors[n] = tmp;
        } else if (removeBtn) {
            state.contributors.splice(Number(removeBtn.dataset.contribRemove), 1);
        } else if (addSocial) {
            const ci = Number(addSocial.dataset.addSocial);
            if (!state.contributors[ci].socials) state.contributors[ci].socials = [];
            state.contributors[ci].socials.push({ platform: 'instagram', url: '' });
        } else if (removeSocial) {
            const ci = Number(removeSocial.closest('[data-contrib-idx]').dataset.contribIdx);
            state.contributors[ci].socials.splice(Number(removeSocial.dataset.removeSocial), 1);
        }

        renderContribSidebar();
    });
}

// ─── Switch-template confirmation modal ───────────────────────────────────────

function showModal() { els.modalOverlay.style.display = 'flex'; }
function hideModal() { els.modalOverlay.style.display = 'none'; }

function initSwitchTemplateModal() {
    document.getElementById('modal-cancel').addEventListener('click', function() { state.pendingTemplate = null; hideModal(); });
    document.getElementById('modal-confirm').addEventListener('click', function() {
        hideModal(); if (state.pendingTemplate) { applyTemplate(state.pendingTemplate); state.pendingTemplate = null; }
    });
    els.modalOverlay.addEventListener('click', function(e) {
        if (e.target === els.modalOverlay) { state.pendingTemplate = null; hideModal(); }
    });
}

// ─── Clear post ───────────────────────────────────────────────────────────────

function isPostEmpty() {
    if (state.blocks.length > 0) return false;
    if (state.contributors.length > 0) return false;
    if (state.templateId && state.templateId !== 'blank') return false;
    for (var i = 0; i < FORM_FIELDS.length; i++) {
        if (getVal(FORM_FIELDS[i])) return false;
    }
    return true;
}

function clearPost() {
    FORM_FIELDS.forEach(function(id) {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    setDefaultDate();
    filenameAutoFill = true;
    applyTemplate('blank'); // resets blocks, contributors, template, output
}

function showClearModal() { els.clearModalOverlay.style.display = 'flex'; }
function hideClearModal() { els.clearModalOverlay.style.display = 'none'; }

function requestClear() {
    if (isPostEmpty()) { clearPost(); return; }
    showClearModal();
}

function initClearPostEvents() {
    document.getElementById('btn-clear-post').addEventListener('click', requestClear);
    const stepClear = document.getElementById('btn-clear-post-step');
    if (stepClear) stepClear.addEventListener('click', requestClear);
    document.getElementById('clear-modal-cancel').addEventListener('click', hideClearModal);
    document.getElementById('clear-modal-confirm').addEventListener('click', function() {
        hideClearModal();
        clearPost();
    });
    els.clearModalOverlay.addEventListener('click', function(e) {
        if (e.target === els.clearModalOverlay) hideClearModal();
    });
}

// ─── Save / Load ──────────────────────────────────────────────────────────────

function getSaveData() {
    syncBlocksFromDOM();
    syncContributorsFromDOM();
    const fields = {};
    FORM_FIELDS.forEach(function(id) {
        // Strip the f- prefix → "f-end-date" becomes "endDate"
        const key = id.replace(/^f-/, '').replace(/-(.)/g, function(_, c) { return c.toUpperCase(); });
        fields[key] = getVal(id);
    });
    fields.date = getVal('f-date'); // not in FORM_FIELDS list (auto-set, not user-cleared)
    return {
        templateId: state.templateId,
        settings: state.settings,
        blocks: state.blocks,
        contributors: state.contributors,
        showContributors: state.showContributors,
        fields: fields
    };
}

function applySaveData(data) {
    if (!data || !data.templateId) { alert('This save file does not have a valid template.'); return; }
    state.templateId = data.templateId;
    state.settings = Object.assign({ isEvent: false, hasSlideshowCss: false, showContributors: false }, data.settings || {});
    state.blocks = data.blocks || [];
    state.contributors = data.contributors || [];
    state.showContributors = !!data.showContributors;
    filenameAutoFill = false;
    updateDetailsFields();
    updateContribSidebarVisibility();
    renderTemplateNav();
    renderContentBuilder();
    if (state.showContributors) renderContribSidebar();
    updateSaveButtonState();
    clearOutput();
    if (data.fields) {
        const setIfPresent = function(id, v) { const el = document.getElementById(id); if (el && v) el.value = v; };
        const f = data.fields;
        setIfPresent('f-title', f.title);
        setIfPresent('f-author', f.author);
        setIfPresent('f-date', f.date);
        setIfPresent('f-end-date', f.endDate);
        setIfPresent('f-thumbnail', f.thumbnail);
        setIfPresent('f-filename', f.filename);
    }
}

function downloadFallback(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}

async function saveDraftAs() {
    const data = getSaveData();
    const json = JSON.stringify(data, null, 2);
    const fname = (els.fFilename.value || '').trim();
    const suggestedName = (slugify(fname) || 'untitled-blog-post') + '-draft.json';

    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: suggestedName,
                types: [{ description: 'Blog Post Draft (JSON)', accept: { 'application/json': ['.json'] } }]
            });
            const writable = await handle.createWritable();
            await writable.write(json);
            await writable.close();
            return;
        } catch (err) {
            if (err && err.name === 'AbortError') return; // user cancelled
            console.error('Save As failed, falling back to download:', err);
        }
    }
    downloadFallback(json, suggestedName, 'application/json');
}

function initSaveLoadEvents() {
    els.btnSave.addEventListener('click', saveDraftAs);
    document.getElementById('btn-load-layout').addEventListener('click', openLoadMenu);
    els.importFile.addEventListener('change', function() {
        const file = this.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) { try { applySaveData(JSON.parse(e.target.result)); } catch(err) { alert('Could not read save file.'); } };
        reader.readAsText(file); this.value = '';
    });
}

// ─── Draft autosave (localStorage) ────────────────────────────────────────────
// Auto-persists the current builder state to localStorage on every change
// (debounced). Drafts surface in the Load button's dropdown so the user can
// resume previous work without having had to download/upload a JSON file.

const DRAFT_PREFIX        = 'cadre.postgen.draft.';
const DRAFT_INDEX_KEY     = 'cadre.postgen.draft.__index__';
const DRAFT_MAX_AGE_MS    = 30 * 24 * 60 * 60 * 1000;   // 30 days
const DRAFT_AUTOSAVE_MS   = 800;                         // debounce
const DRAFT_LIST_LIMIT    = 5;                           // shown in menu

let draftSaveTimer = null;

function draftCurrentSlug() {
    const raw = (els.fFilename && els.fFilename.value || '').trim();
    return slugify(raw) || 'untitled-blog-post';
}

function draftCurrentKey() { return DRAFT_PREFIX + draftCurrentSlug(); }

function draftReadIndex() {
    try { return JSON.parse(localStorage.getItem(DRAFT_INDEX_KEY) || '[]'); }
    catch (_) { return []; }
}

function draftWriteIndex(arr) {
    try { localStorage.setItem(DRAFT_INDEX_KEY, JSON.stringify(arr)); }
    catch (_) { /* quota or disabled — silently no-op */ }
}

function draftPruneExpired() {
    const cutoff = Date.now() - DRAFT_MAX_AGE_MS;
    const next = [];
    draftReadIndex().forEach(function(entry) {
        if (entry.savedAt && entry.savedAt < cutoff) {
            try { localStorage.removeItem(DRAFT_PREFIX + entry.slug); } catch (_) {}
            return;
        }
        next.push(entry);
    });
    draftWriteIndex(next);
}

function draftUpsertIndex(slug, title) {
    const arr = draftReadIndex().filter(function(e) { return e.slug !== slug; });
    arr.unshift({ slug: slug, title: title || slug, savedAt: Date.now() });
    draftWriteIndex(arr.slice(0, 20));
}

function autosaveDraft() {
    if (!state.templateId) return;
    if (!hasBlocks() && !(els.fTitle && els.fTitle.value)) return;  // nothing worth saving
    try {
        const data = getSaveData();
        const slug = draftCurrentSlug();
        localStorage.setItem(DRAFT_PREFIX + slug, JSON.stringify(data));
        draftUpsertIndex(slug, (data.fields && data.fields.title) || '');
    } catch (err) {
        // Quota errors are non-fatal — we don't surface them.
        console.warn('Autosave failed:', err);
    }
}

function scheduleAutosave() {
    clearTimeout(draftSaveTimer);
    draftSaveTimer = setTimeout(autosaveDraft, DRAFT_AUTOSAVE_MS);
}

function initAutosave() {
    draftPruneExpired();
    // Watch the form fields …
    ['f-title', 'f-author', 'f-date', 'f-end-date', 'f-thumbnail', 'f-filename'].forEach(function(id) {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', scheduleAutosave);
    });
    // … and the content builder + contributor sidebar (re-rendered HTML
    // counts as a state change since post-gen.js replaces .innerHTML).
    if (els.contentBuilder) {
        els.contentBuilder.addEventListener('input', scheduleAutosave);
        new MutationObserver(scheduleAutosave).observe(els.contentBuilder, { childList: true, subtree: false });
    }
    if (els.contribSidebar) {
        els.contribSidebar.addEventListener('input', scheduleAutosave);
        new MutationObserver(scheduleAutosave).observe(els.contribSidebar, { childList: true, subtree: false });
    }
}

// ─── Load button: file picker + recent-drafts popover ─────────────────────────

let loadMenuEl = null;

function closeLoadMenu() {
    if (loadMenuEl) { loadMenuEl.remove(); loadMenuEl = null; }
    document.removeEventListener('click', onLoadMenuDocClick, true);
    document.removeEventListener('keydown', onLoadMenuKey);
}

function onLoadMenuDocClick(e) {
    if (loadMenuEl && !loadMenuEl.contains(e.target) && !(e.target && e.target.id === 'btn-load-layout')) {
        closeLoadMenu();
    }
}
function onLoadMenuKey(e) { if (e.key === 'Escape') closeLoadMenu(); }

function openLoadMenu() {
    closeLoadMenu();
    draftPruneExpired();
    const drafts = draftReadIndex().slice(0, DRAFT_LIST_LIMIT);
    const btn = document.getElementById('btn-load-layout');
    if (!btn) return;

    const menu = document.createElement('div');
    menu.className = 'load-menu';
    let html = '<button class="load-menu-item" data-load-action="file">📂 Open file…</button>';
    if (drafts.length) {
        html += '<div class="load-menu-divider">Recent drafts</div>';
        drafts.forEach(function(d) {
            const when = new Date(d.savedAt);
            const label = d.title && d.title.trim() ? d.title : d.slug;
            html += '<button class="load-menu-item load-menu-draft" data-load-action="draft" data-slug="'
                  + escHtml(d.slug) + '">'
                  + '<span class="load-menu-draft-title">' + escHtml(label) + '</span>'
                  + '<span class="load-menu-draft-when">' + when.toLocaleString() + '</span>'
                  + '</button>';
        });
        html += '<button class="load-menu-item load-menu-clear" data-load-action="forget-all">Forget all drafts</button>';
    } else {
        html += '<div class="load-menu-empty">No saved drafts yet.</div>';
    }
    menu.innerHTML = html;

    const rect = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top  = (rect.bottom + 4) + 'px';
    menu.style.left = (rect.right - 260) + 'px';   // right-align under button
    document.body.appendChild(menu);
    loadMenuEl = menu;

    menu.addEventListener('click', function(e) {
        const item = e.target.closest('[data-load-action]');
        if (!item) return;
        const action = item.dataset.loadAction;
        if (action === 'file') {
            closeLoadMenu();
            els.importFile.click();
        } else if (action === 'draft') {
            const slug = item.dataset.slug;
            const raw = localStorage.getItem(DRAFT_PREFIX + slug);
            closeLoadMenu();
            if (!raw) { alert('Draft is no longer available.'); return; }
            try { applySaveData(JSON.parse(raw)); } catch (_) { alert('Could not read draft.'); }
        } else if (action === 'forget-all') {
            if (!confirm('Forget all saved drafts? This cannot be undone.')) return;
            draftReadIndex().forEach(function(d) {
                try { localStorage.removeItem(DRAFT_PREFIX + d.slug); } catch (_) {}
            });
            draftWriteIndex([]);
            closeLoadMenu();
        }
    });

    setTimeout(function() {
        document.addEventListener('click',   onLoadMenuDocClick, true);
        document.addEventListener('keydown', onLoadMenuKey);
    }, 0);
}

// ─── File drag-drop overlay ───────────────────────────────────────────────────

function initFileDropOverlay() {
    let dragCounter = 0;
    const overlay = els.dropOverlay;

    window.addEventListener('dragenter', function(e) {
        if (e.dataTransfer && e.dataTransfer.types && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1) {
            dragCounter++;
            overlay.classList.add('active');
        }
    });
    window.addEventListener('dragleave', function() {
        dragCounter--;
        if (dragCounter <= 0) { dragCounter = 0; overlay.classList.remove('active'); }
    });
    window.addEventListener('dragover', function(e) { e.preventDefault(); });
    window.addEventListener('drop', function(e) {
        e.preventDefault();
        dragCounter = 0;
        overlay.classList.remove('active');
        const file = e.dataTransfer && e.dataTransfer.files[0];
        if (!file || !file.name.endsWith('.json')) return;
        const reader = new FileReader();
        reader.onload = function(ev) { try { applySaveData(JSON.parse(ev.target.result)); } catch(err) { alert('Could not read save file.'); } };
        reader.readAsText(file);
    });
}

// ─── Generate button ──────────────────────────────────────────────────────────

function initGenerateButton() {
    document.getElementById('btn-generate').addEventListener('click', function() {
        if (!state.templateId) { alert('Please choose a template first.'); return; }
        syncBlocksFromDOM();
        syncContributorsFromDOM();
        els.outHtml.value = buildFullHTML();
        els.outJson.value = buildJSONEntry();
        els.outputSection.classList.add('visible');
        els.outputSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}

// ─── Preview ──────────────────────────────────────────────────────────────────

// Generated posts use `../`-prefixed asset paths because they live in
// /Announcements-Blogs/. Inject a <base> pointing at that folder so the
// preview iframe (and any "open in new tab" blob) resolves CSS/JS/images
// exactly like the deployed post.
function buildPreviewHtml() {
    if (!state.templateId) { alert('Please choose a template first.'); return null; }
    syncBlocksFromDOM();
    syncContributorsFromDOM();
    const html = buildFullHTML();
    if (!html) return null;
    const baseHref = new URL('../Announcements-Blogs/', window.location.href).href;
    const baseTag  = '<base href="' + baseHref + '">';
    return html.replace(/<head([^>]*)>/i, '<head$1>\n    ' + baseTag);
}

function openPreview() {
    const html = buildPreviewHtml();
    if (html === null) return;
    els.previewIframe.srcdoc = html;
    els.previewOverlay.style.display = 'flex';
    document.body.classList.add('preview-open');
}

function closePreview() {
    els.previewOverlay.style.display = 'none';
    document.body.classList.remove('preview-open');
    els.previewIframe.srcdoc = '';
}

function isPreviewOpen() {
    return els.previewOverlay.style.display === 'flex';
}

function initPreviewEvents() {
    document.getElementById('btn-preview').addEventListener('click', openPreview);
    document.getElementById('btn-preview-close').addEventListener('click', closePreview);

    document.getElementById('btn-preview-refresh').addEventListener('click', function() {
        const html = buildPreviewHtml();
        if (html === null) return;
        els.previewIframe.srcdoc = html;
    });

    document.getElementById('btn-preview-newtab').addEventListener('click', function() {
        const html = buildPreviewHtml();
        if (html === null) return;
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url  = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(function() { URL.revokeObjectURL(url); }, 60000);
    });

    els.previewOverlay.addEventListener('click', function(e) {
        if (e.target === els.previewOverlay) closePreview();
    });

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && isPreviewOpen()) closePreview();
    });
}

// ─── Output buttons ───────────────────────────────────────────────────────────

function initOutputButtons() {
    document.getElementById('btn-copy-html').addEventListener('click', function() { copyToClipboard(els.outHtml.value, this); });
    document.getElementById('btn-copy-json').addEventListener('click', function() { copyToClipboard(els.outJson.value, this); });
    document.getElementById('btn-download-html').addEventListener('click', function() {
        downloadFallback(els.outHtml.value, getFilename(), 'text/html;charset=utf-8');
    });
}

// ─── Filename auto-fill from title ────────────────────────────────────────────

function initFilenameSync() {
    els.fTitle.addEventListener('input', function() {
        if (!filenameAutoFill) return;
        els.fFilename.value = slugify(this.value);
    });
    els.fFilename.addEventListener('input', function() {
        filenameAutoFill = false;
    });
}

// ─── Sidebar collapse toggles (template + admin) ──────────────────────────────
// Each sidebar has a small button in its outer corner that flips a body class
// on/off. CSS shrinks the sidebar to a 36px stub when collapsed; the toggle
// remains visible as the re-open affordance. State persists in localStorage.

const SIDEBAR_STATE_KEY = 'cadre.postgen.sidebarState';

function readSidebarState() {
    try {
        return JSON.parse(localStorage.getItem(SIDEBAR_STATE_KEY) || '{}') || {};
    } catch (_) { return {}; }
}
function writeSidebarState(state) {
    try { localStorage.setItem(SIDEBAR_STATE_KEY, JSON.stringify(state)); } catch (_) {}
}

function setSidebarCollapsed(which /* 'template' | 'admin' */, collapsed) {
    const bodyCls   = which + '-sidebar-collapsed';
    const btn       = document.getElementById('btn-' + which + '-sidebar-toggle');
    const openIcon  = which === 'admin' ? '▶' : '◀';   // collapse direction
    const closeIcon = which === 'admin' ? '◀' : '▶';   // expand direction
    document.body.classList.toggle(bodyCls, collapsed);
    if (btn) {
        btn.textContent = collapsed ? closeIcon : openIcon;
        btn.title       = collapsed ? 'Show ' + which + ' sidebar' : 'Hide ' + which + ' sidebar';
        btn.setAttribute('aria-label', btn.title);
    }
    const state = readSidebarState();
    state[which] = !!collapsed;
    writeSidebarState(state);
}

function initSidebarToggles() {
    const saved = readSidebarState();
    if (saved.template) setSidebarCollapsed('template', true);
    if (saved.admin)    setSidebarCollapsed('admin', true);

    const tBtn = document.getElementById('btn-template-sidebar-toggle');
    if (tBtn) tBtn.addEventListener('click', function() {
        setSidebarCollapsed('template', !document.body.classList.contains('template-sidebar-collapsed'));
    });
    const aBtn = document.getElementById('btn-admin-sidebar-toggle');
    if (aBtn) aBtn.addEventListener('click', function() {
        setSidebarCollapsed('admin', !document.body.classList.contains('admin-sidebar-collapsed'));
    });
}

// ─── Settings (persisted in localStorage) ─────────────────────────────────────
// Single source of truth for tool-wide preferences. Currently:
//   - showImageThumbnails: render preview thumbnails in the image folder tab
// New settings: add to DEFAULT_SETTINGS, render a new row in the modal HTML
// (post-gen-modals.js), and apply via applySettings().

const SETTINGS_KEY = 'cadre.postgen.settings.v1';
const DEFAULT_SETTINGS = { showImageThumbnails: true };

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
    if (!overlay || !openBtn || !thumbsTog) return;

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

// ─── Init ─────────────────────────────────────────────────────────────────────

initElementCache();
applySettings(loadSettings());     // apply persisted prefs BEFORE the trees render
initEvents();
initContribEvents();
initTemplateNavEvents();
initSwitchTemplateModal();
initClearPostEvents();
initSaveLoadEvents();
initFileDropOverlay();
initGenerateButton();
initPreviewEvents();
initOutputButtons();
initFilenameSync();
initImagePickerButtons();
initSidebarToggles();
initSettingsModal();
initAutosave();
loadTemplates();
loadBaseTemplate();
setDefaultDate();
