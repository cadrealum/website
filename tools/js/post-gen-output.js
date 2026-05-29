// HTML & JSON generation for the post generator.
// All functions here read from state / BLOCK_TYPES / socialPlatforms (defined
// in post-gen-data.js) and from the small set of utils in post-gen.js.
// Function references resolve at call time, so script load order
// (data → output → main) is sufficient.

const BLOG_BODY_INDENT              = 20; // <div class="blog-body"> inner indent (no sidebar)
const BLOG_BODY_INDENT_WITH_SIDEBAR = 24; // <div class="blog-body"> inner indent (with sidebar)
const TWO_COL_ROW_INDENT_DELTA      = 4;  // each nested level in blog-two-col adds this

const SPACES_CACHE = {};
function spaces(n) {
    return SPACES_CACHE[n] || (SPACES_CACHE[n] = ' '.repeat(n));
}

function blockToBodyHtml(b, indent) {
    const px = indent || spaces(BLOG_BODY_INDENT);
    const type = BLOCK_TYPES[b.type];
    return type ? type.toBodyHtml(b, px) : '';
}

function buildTwoColAt(items, baseSpaces) {
    const colA = items.filter(function(b) { return b.col === 'A'; });
    const colB = items.filter(function(b) { return b.col === 'B'; });
    const rowSp   = baseSpaces + TWO_COL_ROW_INDENT_DELTA;
    const cellSp  = rowSp + TWO_COL_ROW_INDENT_DELTA;
    const blockSp = cellSp + TWO_COL_ROW_INDENT_DELTA;
    const count = Math.max(colA.length, colB.length);
    const rows = [];
    for (var i = 0; i < count; i++) {
        const left  = colA[i] ? blockToBodyHtml(colA[i], spaces(blockSp)) : '';
        const right = colB[i] ? blockToBodyHtml(colB[i], spaces(blockSp)) : '';
        rows.push(spaces(rowSp) + '<div class="blog-row">\n'
            + spaces(cellSp) + '<div class="blog-row-text">\n' + left + '\n' + spaces(cellSp) + '</div>\n'
            + spaces(cellSp) + '<div class="blog-row-media">\n' + right + '\n' + spaces(cellSp) + '</div>\n'
            + spaces(rowSp) + '</div>');
    }
    return spaces(baseSpaces) + '<div class="blog-two-col">\n' + rows.join('\n\n') + '\n' + spaces(baseSpaces) + '</div>';
}

// Walk blocks in order, grouping consecutive col-assigned blocks into a
// two-col segment so the stack order is preserved in the generated HTML.
function buildBodyInner(blocks, blockSpaces) {
    const segments = [];
    let current = null;
    blocks.forEach(function(b) {
        const segType = b.col ? 'col' : 'full';
        if (!current || current.type !== segType) {
            current = { type: segType, items: [] };
            segments.push(current);
        }
        current.items.push(b);
    });
    return segments.map(function(seg) {
        if (seg.type === 'full') {
            return seg.items.map(function(b) { return blockToBodyHtml(b, spaces(blockSpaces)); }).join('\n\n');
        }
        return buildTwoColAt(seg.items, blockSpaces);
    }).join('\n\n');
}

function buildContentStr(blocks, hasSidebar) {
    if (hasSidebar) {
        const inner = buildBodyInner(blocks, BLOG_BODY_INDENT_WITH_SIDEBAR);
        return '\n\n' + spaces(16) + '<div class="blog-layout">\n'
            + spaces(20) + '<div class="blog-body">\n' + inner + '\n' + spaces(20) + '</div>\n\n'
            + buildContributorSidebar() + '\n' + spaces(16) + '</div>';
    }
    const inner = buildBodyInner(blocks, BLOG_BODY_INDENT);
    return '\n\n' + spaces(16) + '<div class="blog-body">\n' + inner + '\n' + spaces(16) + '</div>';
}

function buildContributorSidebar() {
    const cards = state.contributors.map(function(c) {
        const socialsHtml = (c.socials || []).filter(function(s) { return s.url; }).map(function(s) {
            const platform = socialPlatforms.find(function(p) { return p.value === s.platform; });
            const iconId  = platform ? platform.icon : null;
            const label   = platform ? platform.label : (s.platform || 'Link');
            const iconSvg = iconId
                ? '<svg aria-hidden="true"><use href="../images/misc/social-icons.svg#' + iconId + '"/></svg>'
                : '🔗';
            return '                                <a href="' + escHtml(s.url) + '" class="social-icon contributor-social" aria-label="' + escHtml(label) + '">' + iconSvg + '</a>';
        }).join('\n');
        const photoSrc = c.photo || PLACEHOLDER_IMG;
        const socialsBlock = socialsHtml ? '\n                            <div class="contributor-socials">\n' + socialsHtml + '\n                            </div>' : '';
        return '                        <div class="contributor-card">\n'
            + '                            <div class="contributor-photo"><img src="../' + escHtml(photoSrc) + '" alt=""></div>\n'
            + '                            <h3 class="contributor-name">' + escHtml(c.name) + '</h3>' + socialsBlock + '\n'
            + '                        </div>';
    }).join('\n\n');
    return '                <aside class="blog-sidebar">\n'
        + '                    <h2 class="blog-sidebar-title">Contributors:</h2>\n'
        + '                    <div class="contributor-list">\n' + cards + '\n                    </div>\n'
        + '                </aside>';
}

function buildFullHTML() {
    if (!baseTemplate) {
        alert('Base template failed to load — refresh the page and try again.');
        return '';
    }
    const title  = getVal('f-title');
    const author = getVal('f-author');
    const date   = getVal('f-date');

    const hasSidebar     = state.showContributors && state.contributors.length > 0;
    const needsSlideshow = state.settings.hasSlideshowCss
        || state.blocks.some(function(b) { return b.type === 'slideshow'; });

    const so = '<' + 'script', sc = '</' + 'script>';
    const slideshowCss = needsSlideshow ? '\n    <link rel="stylesheet" href="../css/slideshow.css">' : '';
    const slideshowJs  = needsSlideshow ? '\n    ' + so + ' src="../js/Slideshow.js">' + sc : '';

    const content = buildContentStr(state.blocks, hasSidebar);

    return baseTemplate
        .replace('{{PAGE_TITLE}}',   escHtml(title))
        .replace('{{POST_TITLE}}',   escHtml(title))
        .replace('{{POST_DATE}}',    escHtml(formatDisplayDate(date)))
        .replace('{{POST_AUTHOR}}',  escHtml(author))
        .replace('{{POST_CONTENT}}', content)
        .replace('{{SLIDESHOW_CSS}}', slideshowCss)
        .replace('{{SLIDESHOW_JS}}',  slideshowJs);
}

function buildJSONEntry() {
    const title     = getVal('f-title');
    const date      = getVal('f-date');
    const endDate   = getVal('f-end-date');
    const thumbnail = getVal('f-thumbnail');
    const filename  = getFilename();
    let entry = '        {\n'
        + '            "href": "Announcements-Blogs/' + escJson(filename) + '",\n'
        + '            "title": "' + escJson(title) + '",\n'
        + '            "date": "' + formatJsonDate(date) + '"';
    if (state.settings.isEvent && endDate) entry += ',\n            "end_date": "' + formatJsonDate(endDate) + '"';
    entry += ',\n            "thumbnail": "' + escJson(thumbnail) + '"\n        },';
    return entry;
}
