const BG_SQUARES = {
    minSize: 80,
    maxSize: 160,
    minOpacity: 0.25,
    maxOpacity: 0.30,
    perPanel: 12,
    gutterMinWidth: 100,
    colorVars: ['--color-primary', '--color-accent', '--color-complimentary']
};

function randomBetween(min, max) {
    return min + Math.random() * (max - min);
}

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function buildSquare(panelWidth, panelHeight, palette) {
    const size = randomBetween(BG_SQUARES.minSize, BG_SQUARES.maxSize);
    const x = randomBetween(-size * 0.3, panelWidth - size * 0.7);
    const y = randomBetween(0, Math.max(0, panelHeight - size));
    const color = pick(palette);
    const opacity = randomBetween(BG_SQUARES.minOpacity, BG_SQUARES.maxOpacity);

    const sq = document.createElement('span');
    sq.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px;background-image:linear-gradient(to right, ${color}, transparent);opacity:${opacity.toFixed(3)};`;
    return sq;
}

function getPalette() {
    const styles = getComputedStyle(document.documentElement);
    return BG_SQUARES.colorVars
        .map(v => styles.getPropertyValue(v).trim())
        .filter(Boolean);
}

function populatePanel(panel) {
    panel.innerHTML = '';
    const width = panel.clientWidth;
    const height = panel.clientHeight;
    if (width < BG_SQUARES.gutterMinWidth) return;

    const palette = getPalette();
    if (palette.length === 0) return;

    const frag = document.createDocumentFragment();
    for (let i = 0; i < BG_SQUARES.perPanel; i++) {
        frag.appendChild(buildSquare(width, height, palette));
    }
    panel.appendChild(frag);
}

const desktopMQ = window.matchMedia('(min-width: 1201px)');

function paintBgSquares() {
    const panels = document.querySelectorAll('.bg-squares');
    if (!desktopMQ.matches) {
        panels.forEach(p => { p.innerHTML = ''; });
        return;
    }
    panels.forEach(populatePanel);
}

let resizeTimer;
function scheduleRepaint() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(paintBgSquares, 150);
}

document.addEventListener('DOMContentLoaded', paintBgSquares);
window.addEventListener('resize', scheduleRepaint);
