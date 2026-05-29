const LOGO_SVG = `
    <svg class="site-logo" viewBox="0 0 1000 700" aria-label="CADRE Alumni" role="img">
        <g fill="currentColor">
            <path d="M209.59,384.02l34.81-197.43c1.07-6.1,6.86-11.01,12.96-11.01h124.29l6.45-36.58h-116.75c-10.25,0-20.02,8.31-21.82,18.55l-1.24,7.01c-1.08,6.1-6.86,11.01-12.96,11.01h-73.49c-11.94,0-23.32,9.68-25.42,21.61l-31.08,176.24c-2.1,11.94,5.86,21.61,17.8,21.61h73.49c5.39,0,9.17,3.84,9.24,8.94l-6.58,33.1h175.71l7.03-42.04h-163.37c-6.1,0-10.15-4.92-9.07-11.01Z"/>
            <polygon points="414.74 215.76 421.83 175.58 381.64 175.58 374.56 215.76 414.74 215.76"/>
            <path d="M432.81,323.73c.62-3.52,3.97-6.37,7.49-6.37h46.73l-9.36,53.09h17.21l21.84-123.89h-17.21l-8.28,46.98c-.6,3.38-3.82,6.11-7.19,6.11h-40.38c-3.64,0-6.08-2.95-5.44-6.6l7.01-39.76c.66-3.72,4.2-6.74,7.92-6.74h46.36l3.12-17.7h-74.66c-7.64,0-14.92,6.19-16.27,13.83l-3.8,21.57-3.12,17.7-3.12,17.7-12.48,70.79h35.4l8.24-46.73Z"/>
            <path d="M598.83,371.48l3.17-17.95h-46.4c-3.32,0-5.53-2.69-4.94-6l16.88-95.73c.58-3.32,3.74-6,7.06-6h46.39l3.16-17.95h-71.38c-9.34,0-18.25,7.57-19.9,16.91l-22.35,126.72h88.31Z"/>
            <path d="M723.3,371.48h26.47l6.54-50.21c.54-2.05-1.5-3.72-4.55-3.72h-12.57l2.2-12.48v-.04c.55-2.97,3.38-5.37,6.35-5.37h5.07c4.13,0,8.07-3.35,8.8-7.48l6.86-38.9c.73-4.14-2.04-7.49-6.17-7.49h-10.47l-.95,5.41-7.59,43.06v.03c-.55,2.98-3.4,5.37-6.36,5.37h-43.59c-2.69,0-4.48-2.19-4.01-4.87l7.78-44.13c.47-2.69,3.04-4.87,5.73-4.87h49l.95-5.4,2.2-12.54h-74.49c-8.45,0-16.49,6.84-17.98,15.28l-22.64,128.36h35.91l8.63-48.92c.49-2.73,3.09-4.94,5.83-4.94h40.55l-7.5,53.86Z"/>
            <path d="M617.88,353.54c3.61,0,7.06-2.93,7.69-6.55l16.7-94.63c.63-3.63-1.78-6.55-5.41-6.55h-15.86l-19,107.74h15.88Z"/>
            <path d="M895,227.84h-54.33c-5.03,0-9.83,4.08-10.71,9.11l-.61,3.44c-.53,2.99-3.36,5.4-6.35,5.4h-18.12c-6.85,0-13.38,5.55-14.58,12.4l-14.63,82.93c-1.21,6.85,3.37,12.4,10.21,12.4h18.48c2.63,0,4.62,2.37,4.16,4.96l-1.25,7.09-1.04,5.91h63.44l3.16-17.96h-58.39c-2.6,0-4.57-2.31-4.18-4.86,0-.03,0-.07,0-.1l1.41-7.99,15.76-89.37c.53-2.99,3.37-5.41,6.36-5.41h58.03l3.17-17.96Z"/>
            <path d="M840.67,285.65c-2.33,0-4.33,1.68-4.74,3.98l-3.25,18.41c-.52,2.95,1.75,5.65,4.74,5.65h18.26c2.33,0,4.33-1.68,4.74-3.98l3.25-18.41c.52-2.95-1.75-5.65-4.74-5.65h-18.26Z"/>
            <path d="M531.67,401.61h-23.44c-2.13,0-3.8,1.43-4.06,3.49l-1.57,12.41c-.26,2.06-1.93,3.49-4.06,3.49h-11.04c-2.13,0-3.8,1.43-4.06,3.49l-1.58,12.45c-.26,2.06-1.93,3.49-4.06,3.49h-13.74c-2.13,0-3.8,1.43-4.06,3.49l-1.76,13.89c-.26,2.06-1.93,3.49-4.06,3.49h-13.52c-2.13,0-3.8,1.43-4.06,3.49l-1.52,12.04c-.26,2.06-1.93,3.49-4.06,3.49h-13.49c-2.13,0-3.8,1.43-4.06,3.49l-1.65,13.05c-.26,2.06-1.93,3.49-4.06,3.49h-10.77c-2.13,0-3.8,1.43-4.06,3.49l-2.68,21.2h.59l-.64.55h35.87c3.1,0,5.77,2.94,5.39,5.93-.26,2.06-1.93,3.49-4.06,3.49h-6.6c-2.13,0-3.8,1.43-4.06,3.49l-2.21,16.51c-.38,2.99,2.29,5.93,5.39,5.93h19.4c2.13,0,3.8-1.43,4.06-3.49l1.26-8.96c.26-2.06,1.93-3.49,4.06-3.49h8.09c2.13,0,3.8-1.43,4.06-3.49l.22-1.7c.47-3.68,5.04-4.73,7.9-1.82l21.29,21.28c1.05,1.06,2.45,1.68,3.84,1.68h8.74c2.06,0,3.7-1.34,4.03-3.31l26.39-154.26c.15-.9-.65-1.82-1.6-1.82Z"/>
            <path d="M647.34,419.21l-8.23,46.7c-.59,3.36-3.79,6.08-7.15,6.08h-40.14c-3.62,0-6.04-2.94-5.4-6.56l6.97-39.52c.65-3.7,4.18-6.7,7.88-6.7h46.08l3.1-17.59h-74.22c-7.59,0-14.83,6.16-16.17,13.75l-3.78,21.44-3.1,17.59-3.1,17.59-12.41,70.37h35.19l8.19-46.45c.62-3.5,3.95-6.33,7.45-6.33h46.45l-9.31,52.78h17.1l21.72-123.15h-17.1Z"/>
            <polygon points="654.95 542.28 676.04 542.28 679.75 521.19 658.67 521.19 654.95 542.28"/>
            <polygon points="819.11 542.28 840.19 542.28 843.91 521.19 822.82 521.19 819.11 542.28"/>
            <path d="M815.33,401.79l.03-.18h-82.12c-8.18,0-16.07,6.65-17.65,14.81l-19,110.49c-1.58,8.06,4.5,15.45,12.68,15.45h87.97c5.36,0,10.55-4.36,11.62-9.71l19.42-112.76c1.71-8.86-4.35-16.98-12.96-18.1ZM797.36,505.3c-1.07,5.83-6.21,10.12-12.13,10.12h-45.09c-7.51,0-13.07-6.74-11.73-14.1l12.2-73.41c1.07-5.86,6.21-10.15,12.13-10.15h59.43l-14.8,87.53Z"/>
        </g>
    </svg>
`;

const HEADER_HTML = `
    <header class="site-header">
        <div class="header-inner">
            <a href="{{root}}index.html" class="site-title">${LOGO_SVG}</a>
            <div class="header-actions">
                <button class="theme-toggle" aria-label="Toggle dark mode">
                    <img class="theme-icon-light" src="{{root}}images/misc/icons8-moon-64.png" alt="">
                    <img class="theme-icon-dark" src="{{root}}images/misc/icons8-sun-64.png" alt="">
                </button>
                <button class="nav-toggle" aria-label="Open menu" aria-expanded="false" aria-controls="site-nav">
                    <span class="nav-toggle-bar"></span>
                    <span class="nav-toggle-bar"></span>
                    <span class="nav-toggle-bar"></span>
                </button>
                <nav id="site-nav" class="site-nav">
                    <button class="nav-close" aria-label="Close menu">
                        <span class="nav-close-bar"></span>
                        <span class="nav-close-bar"></span>
                    </button>
                    <a href="{{root}}index.html" data-page="home">Home</a>
                    <a href="{{root}}about.html" data-page="about">About</a>
                    <a href="{{root}}Announcements-Blogs/index.html" data-page="events">Announcements</a>
                    <a href="{{root}}calender.html" data-page="calendar">Calendar</a>
                </nav>
            </div>
        </div>
    </header>
`;

const FOOTER_HTML = `
    <footer class="site-footer">
        <div class="footer-inner">
            <a href="{{root}}index.html" class="site-title">${LOGO_SVG}</a>
            <div class="footer-socials">
                <a href="#" class="social-icon" aria-label="Instagram"><svg aria-hidden="true"><use href="{{root}}images/misc/social-icons.svg#icon-instagram"/></svg></a>
                <a href="#" class="social-icon" aria-label="Discord"><svg aria-hidden="true"><use href="{{root}}images/misc/social-icons.svg#icon-discord"/></svg></a>
                <a href="#" class="social-icon" aria-label="X"><svg aria-hidden="true"><use href="{{root}}images/misc/social-icons.svg#icon-x"/></svg></a>
                <a href="#" class="social-icon" aria-label="Linktree"><svg aria-hidden="true"><use href="{{root}}images/misc/social-icons.svg#icon-linktree"/></svg></a>
            </div>
        </div>
    </footer>
`;

function injectPartials() {
    const body = document.body;
    const root = body.dataset.root || '';
    const currentPage = body.dataset.page;

    const render = (template) => template.replace(/\{\{root\}\}/g, root);

    const headerSlot = document.getElementById('site-header');
    const footerSlot = document.getElementById('site-footer');

    if (headerSlot) {
        headerSlot.outerHTML = render(HEADER_HTML);
        if (currentPage) {
            const link = document.querySelector(`.site-nav a[data-page="${currentPage}"]`);
            if (link) link.classList.add('active');
        }
    }

    if (footerSlot) {
        footerSlot.outerHTML = render(FOOTER_HTML);
    }

    document.dispatchEvent(new CustomEvent('partials:ready'));
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectPartials);
} else {
    injectPartials();
}
