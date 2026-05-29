// ─── Constants ────────────────────────────────────────────────────────────────

const PLACEHOLDER_IMG = 'images/misc/CAO-placeholder.png';

// Field IDs that map to the form inputs in Step 1. Reused by clearPost,
// isPostEmpty, getSaveData, and applySaveData so the list stays in one place.
const FORM_FIELDS = ['f-title', 'f-author', 'f-thumbnail', 'f-end-date', 'f-filename'];

// Fallbacks if template-data.json fails to load. Kept minimal — the JSON is
// the source of truth, these just keep the UI from breaking entirely.
const BLANK_TEMPLATE_FALLBACK = [
    { id: 'blank', name: 'Blank', icon: '📄', desc: 'Start fresh.',
      settings: {}, blocks: [], contributors: [] }
];
const SOCIAL_PLATFORMS_FALLBACK = [
    { value: 'other', label: 'Website / Other', icon: 'icon-link' }
];

// ─── Mutable State ────────────────────────────────────────────────────────────

const state = {
    templateId: null,
    settings: { isEvent: false, hasSlideshowCss: false },
    blocks: [],          // each: { type, ...fields, col?: 'A'|'B' }
    contributors: [],    // each: { name, photo, socials: [{platform, url}] }
    showContributors: false,
    pendingTemplate: null,
};

let templates = [];
let socialPlatforms = [];
let baseTemplate = null;
let filenameAutoFill = true;

// ─── Block-type Registry ──────────────────────────────────────────────────────
//
// Single source of truth for every supported block type. Each entry defines:
//   label       — badge text + "+ <label>" add-button text
//   badgeClass  — CSS class on the badge ('' for paragraph default)
//   defaults()  — returns a fresh default state object for this block type
//   renderBody(b)        — body HTML shown inside the editor
//   syncFromDOM(b, el)   — reads inputs from the editor DOM back into b
//   toBodyHtml(b, px)    — emits the generated post HTML, indented by px
//
// Note: escHtml / extractYouTubeId are defined in post-gen.js. Because these
// references live inside function bodies, they resolve at call time — by then
// post-gen.js has loaded.
const BLOCK_TYPES = {
    paragraph: {
        label: 'Paragraph',
        badgeClass: '',
        defaults: function() { return { type: 'paragraph', text: '' }; },
        renderBody: function(b) {
            return '<textarea data-field="text" rows="4" placeholder="Write your paragraph here...">'
                + escHtml(b.text) + '</textarea>';
        },
        syncFromDOM: function(b, el) {
            const ta = el.querySelector('[data-field="text"]');
            if (ta) b.text = ta.value;
        },
        toBodyHtml: function(b, px) {
            return px + '<p>' + escHtml(b.text) + '</p>';
        }
    },

    'section-heading': {
        label: 'Section Heading',
        badgeClass: 'type-section-heading',
        defaults: function() { return { type: 'section-heading', text: '' }; },
        renderBody: function(b) {
            return '<input type="text" data-field="text" value="' + escHtml(b.text)
                + '" placeholder="Section heading…">';
        },
        syncFromDOM: function(b, el) {
            const ta = el.querySelector('[data-field="text"]');
            if (ta) b.text = ta.value;
        },
        toBodyHtml: function(b, px) {
            return px + '<h2 class="blog-section-heading">' + escHtml(b.text) + '</h2>';
        }
    },

    divider: {
        label: 'Divider',
        badgeClass: 'type-divider',
        defaults: function() { return { type: 'divider' }; },
        renderBody: function() {
            return '<div class="divider-preview" aria-hidden="true"></div>';
        },
        syncFromDOM: function() { /* no fields */ },
        toBodyHtml: function(b, px) {
            return px + '<hr class="blog-divider">';
        }
    },

    image: {
        label: 'Image',
        badgeClass: 'type-image',
        defaults: function() { return { type: 'image', url: '', alt: '', caption: '' }; },
        renderBody: function(b) {
            return '<div class="field">'
                + '<label>Image Path</label>'
                + '<div class="img-input-row">'
                +   '<input type="text" data-field="url" value="' + escHtml(b.url) + '" placeholder="e.g. images/events/my-photo.jpg">'
                +   '<button type="button" class="btn-pick-image" data-pick-image-for="block-url" title="Pick an image from the server">📁</button>'
                + '</div>'
                + '<div class="field-hint">Path is relative to the site root. Leave blank to use the placeholder image.</div>'
                + '</div>'
                + '<div class="field-grid">'
                + '<div class="field"><label>Alt Text</label><input type="text" data-field="alt" value="' + escHtml(b.alt) + '" placeholder="Brief description"></div>'
                + '<div class="field"><label>Caption (optional)</label><input type="text" data-field="caption" value="' + escHtml(b.caption) + '" placeholder="Caption below image"></div>'
                + '</div>';
        },
        syncFromDOM: function(b, el) {
            ['url', 'alt', 'caption'].forEach(function(f) {
                const x = el.querySelector('[data-field="' + f + '"]');
                if (x) b[f] = x.value;
            });
        },
        toBodyHtml: function(b, px) {
            const src = b.url || PLACEHOLDER_IMG;
            const cap = b.caption ? '\n' + px + '    <figcaption>' + escHtml(b.caption) + '</figcaption>' : '';
            return px + '<figure class="blog-figure">\n'
                + px + '    <img src="../' + escHtml(src) + '" alt="' + escHtml(b.alt) + '">'
                + cap + '\n' + px + '</figure>';
        }
    },

    'youtube-inline': {
        label: 'YouTube Embed',
        badgeClass: 'type-youtube',
        defaults: function() { return { type: 'youtube-inline', url: '' }; },
        renderBody: function(b) {
            return '<div class="field"><label>YouTube URL</label>'
                + '<input type="url" data-field="url" value="' + escHtml(b.url) + '" placeholder="https://www.youtube.com/watch?v=...">'
                + '</div>';
        },
        syncFromDOM: function(b, el) {
            const x = el.querySelector('[data-field="url"]');
            if (x) b.url = x.value;
        },
        toBodyHtml: function(b, px) {
            const vid = extractYouTubeId(b.url);
            const embedUrl = vid ? 'https://www.youtube.com/embed/' + vid : escHtml(b.url);
            return px + '<div class="blog-video">\n'
                + px + '    <div class="blog-video-frame">\n'
                + px + '        <iframe src="' + embedUrl + '" title="Video" frameborder="0"'
                + ' allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"'
                + ' referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>\n'
                + px + '    </div>\n' + px + '</div>';
        }
    },

    slideshow: {
        label: 'Slideshow',
        badgeClass: 'type-slideshow',
        defaults: function() { return { type: 'slideshow', slides: [{ url: '', alt: '' }] }; },
        renderBody: function(b) {
            let slidesHtml = '<div class="slide-list">';
            (b.slides || []).forEach(function(s, si) {
                slidesHtml += '<div class="slide-item" data-slide-idx="' + si + '">'
                    + '<div class="slide-num">' + (si + 1) + '</div>'
                    + '<input type="text" data-slide-url="' + si + '" value="' + escHtml(s.url) + '" placeholder="Image path…" style="flex:2">'
                    + '<button type="button" class="btn-pick-image" data-pick-image-for="slide-url" title="Pick an image from the server">📁</button>'
                    + '<input type="text" data-slide-alt="' + si + '" value="' + escHtml(s.alt) + '" placeholder="Alt text" style="flex:1">'
                    + '<button class="btn-icon danger" data-remove-slide="' + si + '" title="Remove">✕</button>'
                    + '</div>';
            });
            slidesHtml += '</div><div class="add-block-bar"><button class="btn-add" data-add-slide>+ Add Slide</button></div>';
            return slidesHtml;
        },
        syncFromDOM: function(b, el) {
            el.querySelectorAll('[data-slide-url]').forEach(function(x) {
                b.slides[Number(x.dataset.slideUrl)].url = x.value;
            });
            el.querySelectorAll('[data-slide-alt]').forEach(function(x) {
                b.slides[Number(x.dataset.slideAlt)].alt = x.value;
            });
        },
        toBodyHtml: function(b, px) {
            const slidesHtml = (b.slides || []).map(function(s, si) {
                const src = s.url || PLACEHOLDER_IMG;
                return px + '            <img class="slideshow-slide' + (si === 0 ? ' is-active' : '')
                    + '" src="../' + escHtml(src)
                    + '" alt="' + escHtml(s.alt || 'Slide ' + (si + 1)) + '">';
            }).join('\n');
            return px + '<div class="blog-slideshow">\n'
                + px + '    <div class="slideshow" data-autoplay-interval="5000">\n'
                + px + '        <button class="slideshow-arrow slideshow-arrow-prev" aria-label="Previous slide">\n'
                + px + '            <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><polyline points="15 4 7 12 15 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>\n'
                + px + '        </button>\n'
                + px + '        <div class="slideshow-viewport">\n' + slidesHtml + '\n' + px + '        </div>\n'
                + px + '        <button class="slideshow-arrow slideshow-arrow-next" aria-label="Next slide">\n'
                + px + '            <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><polyline points="9 4 17 12 9 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>\n'
                + px + '        </button>\n'
                + px + '        <div class="slideshow-dots" role="tablist" aria-label="Select slide"></div>\n'
                + px + '    </div>\n' + px + '</div>';
        }
    }
};
