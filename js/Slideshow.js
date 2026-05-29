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
            dot.setAttribute('role', 'tab');
            dot.setAttribute('aria-label', `Go to slide ${i + 1}`);
            frag.appendChild(dot);
            return dot;
        });
        this.dotsContainer.appendChild(frag);
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
                dot.setAttribute('aria-selected', idx === this.index ? 'true' : 'false');
            });
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
