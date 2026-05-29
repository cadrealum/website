const BLOG_DATA_PATH = 'json/blog-data.json';

const DEFAULT_POST = {
    href: '#',
    title: 'Untitled Post',
    date: '01-01-2026',
    thumbnail: 'images/misc/CAO-placeholder.png'
};

function getRoot() {
    return document.body.dataset.root || '';
}

function parseBlogDate(str) {
    if (typeof str !== 'string') return parseBlogDate(DEFAULT_POST.date);
    const parts = str.split('-').map(Number);
    if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) {
        return parseBlogDate(DEFAULT_POST.date);
    }
    const [month, day, year] = parts;
    return new Date(year, month - 1, day);
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function formatCardDate(date) {
    const day = String(date.getDate()).padStart(2, '0');
    return `${SHORT_MONTHS[date.getMonth()]} ${day}`;
}

function formatCardDateRange(start, end) {
    if (!end || end.getTime() === start.getTime()) return formatCardDate(start);

    const sameYear = start.getFullYear() === end.getFullYear();
    const sameMonth = sameYear && start.getMonth() === end.getMonth();
    const startDay = String(start.getDate()).padStart(2, '0');
    const endDay = String(end.getDate()).padStart(2, '0');

    if (sameMonth) {
        return `${SHORT_MONTHS[start.getMonth()]} ${startDay} – ${endDay}`;
    }
    if (sameYear) {
        return `${SHORT_MONTHS[start.getMonth()]} ${startDay} – ${SHORT_MONTHS[end.getMonth()]} ${endDay}`;
    }
    return `${SHORT_MONTHS[start.getMonth()]} ${startDay}, ${start.getFullYear()} – ${SHORT_MONTHS[end.getMonth()]} ${endDay}, ${end.getFullYear()}`;
}

let blogDataPromise = null;
function fetchBlogData() {
    if (!blogDataPromise) {
        blogDataPromise = fetch(`${getRoot()}${BLOG_DATA_PATH}`).then(response => {
            if (!response.ok) throw new Error(`Failed to load blog data: ${response.status}`);
            return response.json();
        });
    }
    return blogDataPromise;
}

function showLoadError(container, message = 'Could not load posts. Please try again later.') {
    if (!container) return;
    container.innerHTML = '';
    const note = document.createElement('p');
    note.className = 'news-grid-empty';
    note.textContent = message;
    container.appendChild(note);
}

function withDefaults(post) {
    const merged = { ...DEFAULT_POST, ...(post && typeof post === 'object' ? post : {}) };
    if (!merged.href) merged.href = DEFAULT_POST.href;
    if (!merged.title) merged.title = DEFAULT_POST.title;
    if (!merged.thumbnail) merged.thumbnail = DEFAULT_POST.thumbnail;
    if (!merged.date) merged.date = DEFAULT_POST.date;
    return merged;
}

function decorate(posts, type) {
    return (posts || []).map(post => {
        const filled = withDefaults(post);
        return {
            ...filled,
            _date: parseBlogDate(filled.date),
            _endDate: filled.end_date ? parseBlogDate(filled.end_date) : null,
            _type: type
        };
    });
}

function sortNewestFirst(posts) {
    return [...posts].sort((a, b) => b._date - a._date);
}

function renderNewsCard(post, root) {
    const card = document.createElement('a');
    card.href = `${root}${post.href}`;
    card.className = 'news-card';

    const image = document.createElement('div');
    image.className = 'news-card-image';

    const img = document.createElement('img');
    img.src = `${root}${post.thumbnail}`;
    img.alt = '';
    image.appendChild(img);

    const dateLabel = document.createElement('span');
    dateLabel.className = 'news-card-date';
    dateLabel.textContent = formatCardDateRange(post._date, post._endDate);
    image.appendChild(dateLabel);

    const title = document.createElement('h3');
    title.className = 'news-card-title';
    title.textContent = post.title;

    card.appendChild(image);
    card.appendChild(title);
    return card;
}

function dateSearchTokens(d) {
    return [
        formatCardDate(d),
        `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`,
        `${LONG_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`,
        String(d.getFullYear())
    ];
}

function matchesQuery(post, query) {
    if (!query) return true;
    const q = query.trim().toLowerCase();
    if (!q) return true;

    const tokens = [post.title, post.date, ...dateSearchTokens(post._date)];
    if (post._endDate) {
        tokens.push(post.end_date, ...dateSearchTokens(post._endDate));
        tokens.push(formatCardDateRange(post._date, post._endDate));
    }

    return tokens.join(' ').toLowerCase().includes(q);
}

function renderMiniCard(post, root) {
    const card = document.createElement('a');
    card.href = `${root}${post.href}`;
    card.className = 'news-mini-card';

    const thumb = document.createElement('div');
    thumb.className = 'news-mini-card-thumb';
    const img = document.createElement('img');
    img.src = `${root}${post.thumbnail}`;
    img.alt = '';
    thumb.appendChild(img);

    const body = document.createElement('div');
    body.className = 'news-mini-card-body';

    const dateLine = document.createElement('div');
    dateLine.className = 'news-mini-card-date';
    dateLine.textContent = formatCardDateRange(post._date, post._endDate);

    const title = document.createElement('h3');
    title.className = 'news-mini-card-title';
    title.textContent = post.title;

    body.appendChild(dateLine);
    body.appendChild(title);

    card.appendChild(thumb);
    card.appendChild(body);
    return card;
}

async function populateHomePreview(limit = 3) {
    const columns = document.querySelectorAll('[data-blog-preview]');
    if (columns.length === 0) return;

    const data = await fetchBlogData();
    const root = getRoot();

    columns.forEach(column => {
        const key = column.dataset.blogPreview;
        const list = column.querySelector('.news-list');
        if (!list) return;
        const posts = key === 'combined'
            ? sortNewestFirst([...decorate(data.announcements, 'announcements'), ...decorate(data.events, 'events')]).slice(0, limit)
            : sortNewestFirst(decorate(data[key], key)).slice(0, limit);
        list.innerHTML = '';
        posts.forEach(post => list.appendChild(renderMiniCard(post, root)));
    });

    document.dispatchEvent(new CustomEvent('blog:loaded'));
}

const MOBILE_BREAKPOINT = 520;

function getPageSize(desktopSize, mobileSize) {
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches ? mobileSize : desktopSize;
}

function initListingSection({ posts, gridEl, searchEl, filterEl, paginationEl, pageSize = 9, mobilePageSize = null, cardRenderer = renderNewsCard, urlParam = null }) {
    const root = getRoot();
    const sorted = sortNewestFirst(posts);
    let currentPage = 1;
    let query = '';
    let typeFilter = 'all';
    const effectiveMobile = mobilePageSize ?? pageSize;
    let activePageSize = getPageSize(pageSize, effectiveMobile);

    function readPageFromUrl() {
        if (!urlParam) return 1;
        const n = parseInt(new URLSearchParams(window.location.search).get(urlParam), 10);
        return (Number.isInteger(n) && n > 0) ? n : 1;
    }

    function writePageToUrl(page, mode) {
        if (!urlParam) return;
        const url = new URL(window.location.href);
        if (page > 1) url.searchParams.set(urlParam, String(page));
        else url.searchParams.delete(urlParam);
        if (url.href === window.location.href) return;
        if (mode === 'push') window.history.pushState({ [urlParam]: page }, '', url.href);
        else window.history.replaceState({ [urlParam]: page }, '', url.href);
    }

    currentPage = readPageFromUrl();

    function getFiltered() {
        return sorted.filter(p => {
            if (typeFilter !== 'all' && p._type !== typeFilter) return false;
            return matchesQuery(p, query);
        });
    }

    function renderGrid() {
        gridEl.innerHTML = '';
        const filtered = getFiltered();
        const totalPages = Math.max(1, Math.ceil(filtered.length / activePageSize));
        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;

        const start = (currentPage - 1) * activePageSize;
        const pageItems = filtered.slice(start, start + activePageSize);

        if (pageItems.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'news-grid-empty';
            empty.textContent = 'No matching posts.';
            gridEl.appendChild(empty);
        } else {
            pageItems.forEach(post => gridEl.appendChild(cardRenderer(post, root)));
        }

        renderPagination(totalPages);
        writePageToUrl(currentPage, 'replace');
    }

    function renderPagination(totalPages) {
        paginationEl.innerHTML = '';
        if (totalPages <= 1) return;

        const makeBtn = (label, page, opts = {}) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'news-page-btn';
            btn.textContent = label;
            if (opts.active) btn.classList.add('is-active');
            if (opts.disabled) btn.disabled = true;
            btn.addEventListener('click', () => {
                currentPage = page;
                writePageToUrl(currentPage, 'push');
                renderGrid();
            });
            return btn;
        };

        const makeEllipsis = () => {
            const span = document.createElement('span');
            span.className = 'news-page-ellipsis';
            span.textContent = '…';
            return span;
        };

        const maxNumbers = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches ? 4 : 5;
        let start = Math.max(1, currentPage - Math.floor(maxNumbers / 2));
        let end = start + maxNumbers - 1;
        if (end > totalPages) {
            end = totalPages;
            start = Math.max(1, end - maxNumbers + 1);
        }

        paginationEl.appendChild(makeBtn('«', 1, { disabled: currentPage === 1 }));
        paginationEl.appendChild(makeBtn('‹', currentPage - 1, { disabled: currentPage === 1 }));

        if (start > 1) paginationEl.appendChild(makeEllipsis());
        for (let i = start; i <= end; i++) {
            paginationEl.appendChild(makeBtn(String(i), i, { active: i === currentPage }));
        }
        if (end < totalPages) paginationEl.appendChild(makeEllipsis());

        paginationEl.appendChild(makeBtn('›', currentPage + 1, { disabled: currentPage === totalPages }));
        paginationEl.appendChild(makeBtn('»', totalPages, { disabled: currentPage === totalPages }));
    }

    if (searchEl) {
        searchEl.addEventListener('input', () => {
            query = searchEl.value;
            currentPage = 1;
            renderGrid();
        });
    }

    if (filterEl) {
        const filterButtons = Array.from(filterEl.querySelectorAll('[data-filter]'));
        filterEl.addEventListener('click', e => {
            const btn = e.target.closest('[data-filter]');
            if (!btn) return;
            typeFilter = btn.dataset.filter;
            filterButtons.forEach(b => {
                const active = b === btn;
                b.classList.toggle('is-active', active);
                b.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            currentPage = 1;
            renderGrid();
        });
    }

    window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).addEventListener('change', () => {
        const nextSize = getPageSize(pageSize, effectiveMobile);
        if (nextSize === activePageSize) return;
        activePageSize = nextSize;
        currentPage = 1;
        renderGrid();
    });

    if (urlParam) {
        window.addEventListener('popstate', () => {
            const nextPage = readPageFromUrl();
            if (nextPage === currentPage) return;
            currentPage = nextPage;
            renderGrid();
        });
    }

    renderGrid();
}

async function populateListingPage() {
    const sections = document.querySelectorAll('[data-blog-section]');
    if (sections.length === 0) return;

    const data = await fetchBlogData();

    sections.forEach(section => {
        const key = section.dataset.blogSection;
        const posts = key === 'combined'
            ? [...decorate(data.announcements, 'announcements'), ...decorate(data.events, 'events')]
            : decorate(data[key], key);
        const gridEl = section.querySelector('.news-grid');
        const searchEl = section.querySelector('.news-search input');
        const filterEl = section.querySelector('.news-filter');
        const paginationEl = section.querySelector('.news-pagination');
        if (!gridEl || !paginationEl) return;
        initListingSection({
            posts,
            gridEl,
            searchEl,
            filterEl,
            paginationEl,
            pageSize: key === 'combined' ? 9 : 6,
            cardRenderer: key === 'combined' ? renderMiniCard : renderNewsCard,
            urlParam: 'page'
        });
    });

    document.dispatchEvent(new CustomEvent('blog:loaded'));
}

document.addEventListener('DOMContentLoaded', () => {
    populateHomePreview().catch(err => {
        console.error('[blog-grabber]', err);
        document.querySelectorAll('[data-blog-preview] .news-list').forEach(el => showLoadError(el));
    });
    populateListingPage().catch(err => {
        console.error('[blog-grabber]', err);
        document.querySelectorAll('[data-blog-section] .news-grid').forEach(el => showLoadError(el));
    });
});
