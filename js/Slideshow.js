class Slideshow {
    constructor(root) {
        this.root = root;
        this.slides = Array.from(root.querySelectorAll('.slideshow-slide'));
        this.prevBtn = root.querySelector('.slideshow-arrow-prev');
        this.nextBtn = root.querySelector('.slideshow-arrow-next');
        this.dotsContainer = root.querySelector('.slideshow-dots');

        this.interval = parseInt(root.dataset.autoplayInterval, 10) || 5000;
        this.index = this.slides.findIndex(s => s.classList.contains('is-active'));
        if (this.index < 0) this.index = 0;

        this.autoplayTimer = null;

        this.buildDots();
        this.buildCaption();
        this.goTo(this.index);
        this.bindEvents();
        this.startAutoplay();
    }

    buildDots() {
        const frag = document.createDocumentFragment();
        this.dots = this.slides.map((_, i) => {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'slideshow-dot';
            dot.dataset.index = String(i);
            dot.setAttribute('aria-label', `Go to slide ${i + 1}`);
            frag.appendChild(dot);
            return dot;
        });
        this.dotsContainer.appendChild(frag);
    }

    // Caption showing the active slide's alt text, sits between the image and
    // the controls row. aria-hidden because the alt is already on the <img>, so
    // screen readers would otherwise announce it twice.
    buildCaption() {
        const cap = document.createElement('div');
        cap.className = 'slideshow-caption';
        cap.setAttribute('aria-hidden', 'true');
        this.caption = cap;
        this.root.appendChild(cap);
    }

    bindEvents() {
        this.prevBtn.addEventListener('click', () => {
            this.prev();
            this.restartAutoplay();
        });
        this.nextBtn.addEventListener('click', () => {
            this.next();
            this.restartAutoplay();
        });

        this.dotsContainer.addEventListener('click', e => {
            const dot = e.target.closest('.slideshow-dot');
            if (!dot) return;
            const idx = Number(dot.dataset.index);
            if (Number.isNaN(idx)) return;
            this.goTo(idx);
            this.restartAutoplay();
        });

        this.root.addEventListener('mouseenter', () => this.stopAutoplay());
        this.root.addEventListener('mouseleave', () => this.startAutoplay());
        this.root.addEventListener('focusin', () => this.stopAutoplay());
        this.root.addEventListener('focusout', () => this.startAutoplay());
    }

    goTo(i) {
        const count = this.slides.length;
        this.index = ((i % count) + count) % count;
        this.slides.forEach((slide, idx) => {
            slide.classList.toggle('is-active', idx === this.index);
        });
        if (this.dots) {
            this.dots.forEach((dot, idx) => {
                dot.classList.toggle('is-active', idx === this.index);
                dot.setAttribute('aria-pressed', idx === this.index ? 'true' : 'false');
            });
        }
        if (this.caption) {
            const active = this.slides[this.index];
            this.caption.textContent = active ? (active.getAttribute('alt') || '') : '';
        }
    }

    next() { this.goTo(this.index + 1); }
    prev() { this.goTo(this.index - 1); }

    startAutoplay() {
        if (this.autoplayTimer || this.slides.length < 2) return;
        this.autoplayTimer = setInterval(() => this.next(), this.interval);
    }

    stopAutoplay() {
        if (this.autoplayTimer) {
            clearInterval(this.autoplayTimer);
            this.autoplayTimer = null;
        }
    }

    restartAutoplay() {
        this.stopAutoplay();
        this.startAutoplay();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.slideshow').forEach(el => new Slideshow(el));
});
