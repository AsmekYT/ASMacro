import { listen } from '@tauri-apps/api/event';

export type OverlayPoint = { x: number; y: number };
export type OverlayPayload = {
    points: OverlayPoint[];
    origin: { x: number; y: number };
    single: boolean;
};

const host = document.getElementById('markers') as HTMLElement;

let payload: OverlayPayload = { points: [], origin: { x: 0, y: 0 }, single: false };
let activeIndex = -1;

function toCss(v: number): number {
    return v / (window.devicePixelRatio || 1);
}

function paint() {
    host.innerHTML = '';
    payload.points.forEach((p, i) => {
        const el = document.createElement('div');
        el.className = 'marker'
            + (payload.single ? ' single' : '')
            + (!payload.single && i === activeIndex ? ' active' : '');
        el.style.left = `${toCss(p.x - payload.origin.x)}px`;
        el.style.top = `${toCss(p.y - payload.origin.y)}px`;
        el.textContent = payload.single ? '' : String(i + 1);
        host.appendChild(el);
    });
}

listen<OverlayPayload>('ac-overlay-points', (event) => {
    payload = event.payload;
    if (activeIndex >= payload.points.length) activeIndex = -1;
    paint();
});

listen<{ index: number }>('autoclicker-point', (event) => {
    if (payload.single) return;
    activeIndex = event.payload.index;
    paint();
});

listen('autoclicker-state', () => {
    activeIndex = -1;
    paint();
});
