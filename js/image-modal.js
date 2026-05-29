const MODAL_EXCLUDE_SELECTOR = [
    '.news-card img',
    '.news-mini-card img',
    '.contributor-photo img',
    '.site-logo',
    '.bg-squares img',
    '.no-modal',
    '.about-link img'
].join(', ');

function isEligibleImage(img) {
    if (!img.closest('main')) return false;
    if (img.matches(MODAL_EXCLUDE_SELECTOR)) return false;
    if (img.closest('.news-card, .news-mini-card, .contributor-photo, .about-link')) return false;
    return true;
}

function collectImages() {
    return Array.from(document.querySelectorAll('main img')).filter(isEligibleImage);
}

function buildModal() {
    const modal = document.createElement('div');
    modal.className = 'image-modal';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Image viewer');
    modal.innerHTML = `
        <div class="image-modal-backdrop" data-modal-close></div>
        <button class="image-modal-close" type="button" aria-label="Close" data-modal-close>&times;</button>
        <button class="image-modal-arrow image-modal-prev" type="button" aria-label="Previous image">
            <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
                <polyline points="15 4 7 12 15 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </button>
        <figure class="image-modal-figure">
            <img class="image-modal-image" alt="">
            <figcaption class="image-modal-caption"></figcaption>
        </figure>
        <button class="image-modal-arrow image-modal-next" type="button" aria-label="Next image">
            <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true">
                <polyline points="9 4 17 12 9 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </button>
        <div class="image-modal-counter" aria-live="polite"></div>
    `;
    document.body.appendChild(modal);
    return modal;
}

function captionFor(img) {
    const figure = img.closest('figure');
    const caption = figure && figure.querySelector('figcaption');
    if (caption && caption.textContent.trim()) return caption.textContent.trim();
    return img.alt || '';
}

function initImageModal() {
    const images = collectImages();
    if (images.length === 0) return;

    const modal = buildModal();
    const modalImg = modal.querySelector('.image-modal-image');
    const modalCaption = modal.querySelector('.image-modal-caption');
    const modalCounter = modal.querySelector('.image-modal-counter');
    const prevBtn = modal.querySelector('.image-modal-prev');
    const nextBtn = modal.querySelector('.image-modal-next');

    let currentIndex = 0;

    function render(i) {
        const count = images.length;
        currentIndex = ((i % count) + count) % count;
        const img = images[currentIndex];
        modalImg.src = img.currentSrc || img.src;
        modalImg.alt = img.alt || '';
        const caption = captionFor(img);
        modalCaption.textContent = caption;
        modalCaption.hidden = !caption;
        modalCounter.textContent = `${currentIndex + 1} / ${count}`;
        const single = count <= 1;
        prevBtn.hidden = single;
        nextBtn.hidden = single;
    }

    function open(i) {
        render(i);
        modal.hidden = false;
        document.body.classList.add('image-modal-open');
    }

    function close() {
        modal.hidden = true;
        document.body.classList.remove('image-modal-open');
        modalImg.src = '';
    }

    images.forEach((img, i) => {
        img.classList.add('image-modal-trigger');
        img.addEventListener('click', () => open(i));
    });

    prevBtn.addEventListener('click', () => render(currentIndex - 1));
    nextBtn.addEventListener('click', () => render(currentIndex + 1));

    modal.addEventListener('click', e => {
        if (e.target.closest('[data-modal-close]')) close();
    });

    document.addEventListener('keydown', e => {
        if (modal.hidden) return;
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowLeft') render(currentIndex - 1);
        else if (e.key === 'ArrowRight') render(currentIndex + 1);
    });
}

document.addEventListener('DOMContentLoaded', initImageModal);
