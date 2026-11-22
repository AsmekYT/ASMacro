import { invoke } from '@tauri-apps/api/core';
import { getMousePos as readMousePos } from '../platformInfo';
import { evaluateNode, interpreterState, type Evaluator } from './index';

let mousePosCache: { pos: [number, number]; at: number } | null = null;
async function getMousePos(): Promise<[number, number]> {
    const now = Date.now();
    if (mousePosCache && now - mousePosCache.at < 16) return mousePosCache.pos;
    const pos = await readMousePos();
    mousePosCache = { pos, at: now };
    return pos;
}

type RegionData = { x: number; y: number; w: number; h: number } | null;

function regionFromData(data: any): RegionData {
    const r = data?.region;
    if (r && typeof r === 'object' && r.w > 0 && r.h > 0) return { x: r.x, y: r.y, w: r.w, h: r.h };
    return null;
}

let primaryScreenRegion: RegionData = null;
async function regionOrPrimaryScreen(data: any): Promise<RegionData> {
    const r = regionFromData(data);
    if (r) return r;
    if (!primaryScreenRegion) {
        try {
            const size = await invoke<[number, number]>('get_screen_size');
            primaryScreenRegion = { x: 0, y: 0, w: size[0], h: size[1] };
        } catch (e) { return null; }
    }
    return primaryScreenRegion;
}

type OcrWordBox = { text: string; x: number; y: number; w: number; h: number };
export type OcrLineBox = { text: string; words: OcrWordBox[] };
type OcrDto = { text: string; lines: OcrLineBox[]; language: string };

async function readOcr(data: any): Promise<OcrDto | null> {
    try {
        return await invoke<OcrDto>('ocr_read_region', {
            region: regionFromData(data),
            lang: (data.lang || '').trim() || null
        });
    } catch (e) { console.error('ocr_read_region failed:', e); return null; }
}

export function findTextInOcr(lines: OcrLineBox[], needleRaw: string, mode: string, caseSensitive: boolean): { x: number; y: number } | null {
    const norm = (s: string) => (caseSensitive ? s : s.toLowerCase()).replace(/\s+/g, ' ').trim();
    const needle = norm(needleRaw);

    for (const line of lines) {

        let hay = '';
        const spans: { start: number; end: number; word: OcrWordBox }[] = [];
        for (const w of line.words) {
            if (hay.length) hay += ' ';
            const start = hay.length;
            hay += norm(w.text);
            spans.push({ start, end: hay.length, word: w });
        }
        if (!hay) continue;

        let at = -1;
        if (mode === 'EXACT') { if (hay === needle) at = 0; }
        else if (mode === 'WORD') {
            const esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const m = new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'u').exec(hay);
            if (m) at = m.index;
        } else { at = hay.indexOf(needle); }
        if (at < 0) continue;

        const end = mode === 'EXACT' ? hay.length : at + needle.length;
        const hit = spans.filter(s => s.start < end && s.end > at).map(s => s.word);
        if (!hit.length) continue;

        const x1 = Math.min(...hit.map(w => w.x)), y1 = Math.min(...hit.map(w => w.y));
        const x2 = Math.max(...hit.map(w => w.x + w.w)), y2 = Math.max(...hit.map(w => w.y + w.h));
        return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
    }
    return null;
}

export const sensorEvaluators: Record<string, Evaluator> = {
    logic_image_found: async (_block, _workspace, data) => {
        try {
            const res = await invoke<{ x: number; y: number; confidence: number } | null>('find_template_on_screen', {
                templateB64: data.image_data || '',
                tolerance: data.tolerance ?? 30,
                minConfidence: data.min_confidence ?? 80,
                region: regionFromData(data)
            });
            if (res) { interpreterState.globalFoundX = res.x; interpreterState.globalFoundY = res.y; interpreterState.lastConfidence = res.confidence; return true; }
        } catch(e) { console.error('find_template_on_screen failed:', e); } return false;
    },
    logic_color_found: async (_block, _workspace, data) => {
        try {
            const res = await invoke<[number, number] | null>('find_color_on_screen', { hex: data.hex || '#FFFFFF', tolerance: data.tolerance ?? 10, region: regionFromData(data) });
            if (res) { interpreterState.globalFoundX = res[0]; interpreterState.globalFoundY = res[1]; interpreterState.lastConfidence = 0; return true; }
        } catch(e) { console.error('find_color_on_screen failed:', e); } return false;
    },
    sensor_screen_text: async (_block, _workspace, data) => {
        const res = await readOcr(data);
        return res ? res.text : '';
    },
    logic_text_found: async (_block, _workspace, data) => {
        const needleRaw = String(data.search ?? '').trim();
        if (!needleRaw) return false;
        const res = await readOcr(data);
        if (!res) return false;
        const hit = findTextInOcr(res.lines, needleRaw, data.match_mode || 'CONTAINS', data.case_sensitive === 'YES');
        if (!hit) return false;
        interpreterState.globalFoundX = hit.x;
        interpreterState.globalFoundY = hit.y;
        interpreterState.lastConfidence = 100;
        return true;
    },
    logic_pixel_changed: async (block, workspace, data) => {
        const x = await evaluateNode(block.getInputTargetBlock('X'), workspace) ?? 0;
        const y = await evaluateNode(block.getInputTargetBlock('Y'), workspace) ?? 0;
        try { return await invoke<boolean>('pixel_changed', { x: Math.round(x), y: Math.round(y), tolerance: data.tolerance ?? 10, cacheKey: block.id }); } catch(e) { return false; }
    },
    logic_region_motion: async (block, _workspace, data) => {
        const r = await regionOrPrimaryScreen(data);
        if (!r) return false;
        try {
            const pct = await invoke<number>('region_change_percent', { x: r.x, y: r.y, w: r.w, h: r.h, tolerance: data.tolerance ?? 30, cacheKey: block.id });
            return pct >= (data.threshold ?? 5);
        } catch(e) { return false; }
    },
    sensor_region_change: async (block, _workspace, data) => {
        const r = await regionOrPrimaryScreen(data);
        if (!r) return 0;
        try { return await invoke<number>('region_change_percent', { x: r.x, y: r.y, w: r.w, h: r.h, tolerance: data.tolerance ?? 30, cacheKey: block.id }); } catch(e) { return 0; }
    },
    sensor_mouse_x: async () => { const pos = await getMousePos(); return pos[0]; },
    sensor_mouse_y: async () => { const pos = await getMousePos(); return pos[1]; },
    sensor_screen_width: async () => { const size = await invoke<[number, number]>('get_screen_size'); return size[0]; },
    sensor_screen_height: async () => { const size = await invoke<[number, number]>('get_screen_size'); return size[1]; },
    sensor_found_x: async () => interpreterState.globalFoundX,
    sensor_found_y: async () => interpreterState.globalFoundY,
    sensor_match_confidence: async () => interpreterState.lastConfidence,
};
