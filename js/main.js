import init, * as sw from '../pkg/sw_tools_web.js';
import { sliders, resetSliders } from './slider.js';
import { enhanceSelect, syncCombo } from './combo.js';
import { drop_zones } from './drop-zone.js';
import './collapsible.js';
import { createViewer } from './viewer.js';
import { TonePlayer } from './player.js';

const $ = id => document.getElementById(id);
const msg = e => (e instanceof Error ? e.message : String(e));
const stem = f => f.name.replace(/\.[^.]+$/, '');
const bytesOf = async f => new Uint8Array(await f.arrayBuffer());
const fileKey = f => `${f.name}:${f.size}:${f.lastModified}`;
const mmss = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

function download(bytes, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// Runs `job` whenever the file or any setting inside `settingsId` changes. A new file runs at
// once, setting changes wait a moment (so dragging a slider doesn't convert on every step).
// `job` returns a status line; a throw is shown as an error and `onFail` clears the result.
function autoConvert({ settingsId, fileInputId, statusId, job, onFail }) {
    const settings = $(settingsId), status = $(statusId);
    let timer = null, run = 0;

    async function go() {
        const file = drop_zones[fileInputId]?.file;
        if (!file) return;
        const mine = ++run;
        status.classList.remove('error');
        status.textContent = 'Converting...';
        await new Promise(r => setTimeout(r, 0)); // let the UI paint
        try {
            const text = await job(file, () => mine !== run);
            if (mine === run && text !== undefined) status.textContent = text;
        } catch (e) {
            if (mine !== run) return;
            console.error(e);
            status.classList.add('error');
            status.textContent = `Error: ${msg(e)}`;
            onFail?.();
        }
    }

    const later = ms => { clearTimeout(timer); timer = setTimeout(go, ms); };
    settings.addEventListener('input', () => later(300));
    settings.addEventListener('change', e => later(e.target.type === 'file' ? 0 : 300));
    return () => later(0);
}

// One shared viewer; it moves into whichever panel shows a result.
let viewer;
function showPreview(prefix, bytes, side = 1) {
    const result = $(`${prefix}-result`);
    result.hidden = false;
    viewer ??= createViewer(Object.assign(document.createElement('div'), { className: 'viewer' }));
    if (!viewer) return 'preview unavailable';
    result.querySelector('.viewer-slot').appendChild(viewer.el);
    const p = sw.preview(bytes);
    try {
        viewer.setMesh(p, side);
        return `${p.blocks} blocks, ${p.triangles} triangles` +
            (p.custom_shaped < p.blocks ? ` (${p.blocks - p.custom_shaped} drawn as cubes)` : '');
    } finally {
        p.free();
    }
}

function fillBlocks(select, blocks, def) {
    select.innerHTML = '';
    for (const b of blocks) {
        const o = document.createElement('option');
        o.value = String(b.id);
        o.textContent = `${b.name} (${b.id})`;
        select.append(o);
    }
    select.value = String(def);
}

// Catalog tables. Each tab has its columns and rows; the search box filters whichever is shown.
const yes = v => (v ? 'yes' : 'no');
const CATALOGS = {
    blocks: {
        columns: [['ID', 'id', 'num'], ['Name', 'name'], ['Kind', 'kind'], ['Stateless', b => yes(b.stateless)],
            ['Custom shape', b => yes(b.custom_shape)], ['Custom data', 'custom_data']],
        noun: 'blocks',
    },
    props: {
        columns: [['ID', 'id', 'num'], ['Name', 'name'], ['Category', 'category'], ['Flags', 'flags'],
            ['Bounds center', 'bounds_center'], ['Bounds size', 'bounds_size']],
        noun: 'props',
    },
    layers: {
        columns: [['ID', 'id', 'num'], ['Name', 'name'], ['Grows grass', l => yes(l.grass)],
            ['In a new map', l => yes(l.new_map)], ['Hidden', l => yes(l.hidden)]],
        noun: 'layers',
    },
};
let catalogTab = 'blocks';

function renderCatalog() {
    const def = CATALOGS[catalogTab];
    const cell = (row, col) => String(typeof col[1] === 'function' ? col[1](row) : row[col[1]]);

    const head = $('catalog-head');
    head.innerHTML = '';
    const tr = document.createElement('tr');
    for (const col of def.columns) {
        const th = document.createElement('th');
        th.textContent = col[0];
        tr.append(th);
    }
    head.append(tr);

    const terms = $('catalog-filter').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const body = $('catalog-body');
    body.innerHTML = '';
    let shown = 0;
    for (const row of def.rows) {
        const cells = def.columns.map(c => cell(row, c));
        const hay = cells.join(' ').toLowerCase();
        if (!terms.every(t => hay.includes(t))) continue;
        const r = document.createElement('tr');
        cells.forEach((text, i) => {
            const td = document.createElement('td');
            td.textContent = text;
            if (def.columns[i][2]) td.className = def.columns[i][2];
            r.append(td);
        });
        body.append(r);
        shown++;
    }
    $('catalog-status').textContent = `${shown} of ${def.rows.length} ${def.noun}`;
}

const results = {};   // latest output per tool: { bytes, name }

async function setup() {
    await init();
    $('version').textContent = `web v0.1.0 · lib v${sw.version()}`;

    // Tabs
    document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
        document.querySelectorAll('.panel').forEach(p => p.hidden = p.id !== `panel-${tab.dataset.tab}`);
    }));

    // Block lists
    const blocks = JSON.parse(sw.block_catalog());
    fillBlocks($('pixel-block'), blocks.filter(b => b.kind !== 'Tool'), 0);
    fillBlocks($('mesh-block'), blocks.filter(b => b.custom_shape), 109);
    $('pixel-block').dataset.def = '0';
    $('mesh-block').dataset.def = '109';
    CATALOGS.blocks.rows = blocks;
    CATALOGS.props.rows = JSON.parse(sw.prop_catalog());
    CATALOGS.layers.rows = JSON.parse(sw.layer_catalog());
    renderCatalog();
    $('catalog-filter').addEventListener('input', renderCatalog);
    document.querySelectorAll('.subtab').forEach(t => t.addEventListener('click', () => {
        catalogTab = t.dataset.cat;
        document.querySelectorAll('.subtab').forEach(x => x.classList.toggle('active', x === t));
        renderCatalog();
    }));

    // Dropdowns that match the page; the block lists can be searched
    document.querySelectorAll('.panel select').forEach(enhanceSelect);

    const rerun = {};

    // Reset buttons put the panel's settings back and convert again
    document.querySelectorAll('[data-reset]').forEach(btn => btn.addEventListener('click', () => {
        const panel = btn.closest('.panel');
        resetSliders(panel);
        panel.querySelectorAll('input[type="checkbox"]').forEach(c => c.checked = c.defaultChecked);
        panel.querySelectorAll('select').forEach(sel => {
            sel.selectedIndex = sel.dataset.def ? [...sel.options].findIndex(o => o.value === sel.dataset.def) : 0;
            syncCombo(sel);
        });
        rerun[panel.id.replace('panel-', '')]?.();
    }));

    for (const [id, tool] of [['pixel-dl', 'pixel'], ['mesh-dl', 'mesh'], ['music-dl', 'music']]) {
        $(id).addEventListener('click', () => results[tool] && download(results[tool].bytes, results[tool].name));
    }

    // ---- Pixel art ----
    rerun.pixel = autoConvert({
        settingsId: 'pixel-settings', fileInputId: 'image-input', statusId: 'pixel-status',
        onFail: () => { results.pixel = null; $('pixel-result').hidden = true; },
        job: async (f, stale) => {
            const input = await bytesOf(f);
            if (stale()) return;
            const out = sw.pixel_art(input, $('pixel-block').value, sliders.spacing(), sliders.state());
            results.pixel = { bytes: out, name: `${stem(f)}.structure` };
            $('pixel-result').querySelector('.viewer-info').textContent = showPreview('pixel', out, -1);
            return 'Done';
        },
    });

    // ---- Mesh ----
    rerun.mesh = autoConvert({
        settingsId: 'mesh-settings', fileInputId: 'mesh-input', statusId: 'mesh-status',
        onFail: () => { results.mesh = null; $('mesh-result').hidden = true; },
        job: async (f, stale) => {
            const input = await bytesOf(f);
            if (stale()) return;
            const r = sw.mesh(
                input, $('mesh-mode').value === 'wireframe', sliders.thickness(), $('mesh-block').value,
                $('paint').checked, sliders.mergeAngle(), sliders.scale(), $('mesh-mirror').value,
            );
            const info = `${r.triangles} triangles -> ${r.blocks} blocks (${r.merged_quads} quads merged)`;
            const out = r.data;
            r.free();
            results.mesh = { bytes: out, name: `${stem(f)}.structure` };
            $('mesh-result').querySelector('.viewer-info').textContent = showPreview('mesh', out);
            return info;
        },
    });

    // ---- Music player ----
    const player = new TonePlayer();
    player.loopFn = () => $('repeat').checked;
    let soundKey = null;
    const playBtn = $('music-play');

    const setPlaying = on => { playBtn.innerHTML = on ? '&#9632; Stop' : '&#9654; Play'; };
    player.onstop = () => setPlaying(false);
    playBtn.addEventListener('click', () => (player.playing ? player.stop() : player.play().then(() => setPlaying(true))));
    $('music-volume').addEventListener('input', e => player.setVolume(Number(e.target.value)));

    // The position bar doubles as the rewind control: drag or click to jump, playing or not.
    const seek = $('music-seek');
    let scrubbing = false;
    seek.addEventListener('pointerdown', () => { scrubbing = true; });
    window.addEventListener('pointerup', () => { scrubbing = false; });
    seek.addEventListener('keydown', () => { scrubbing = true; });
    seek.addEventListener('keyup', () => { scrubbing = false; });
    seek.addEventListener('input', () => player.seek(Number(seek.value)));

    (function tick() {
        const total = player.duration;
        if (Number(seek.max) !== total) seek.max = total;
        seek.disabled = !total;
        const pos = scrubbing ? Number(seek.value) : player.position;
        if (!scrubbing) seek.value = pos;
        $('music-time').textContent = `${mmss(pos)} / ${mmss(total)}`;
        requestAnimationFrame(tick);
    })();

    rerun.music = autoConvert({
        settingsId: 'music-settings', fileInputId: 'midi-input', statusId: 'music-status',
        onFail: () => { results.music = null; player.stop(); $('music-result').hidden = true; },
        job: async (f, stale) => {
            const midi = await bytesOf(f);
            if (stale()) return;
            const minP = sliders.minPitch(), maxP = sliders.maxPitch(), minV = sliders.minVelocity();
            const drums = $('drums').checked;

            const out = sw.music_player(
                midi, minP, maxP, minV, $('repeat').checked, drums, $('display').checked,
                $('music-title').value.trim() || stem(f),
            );
            results.music = { bytes: out, name: `${stem(f)}.structure` };

            // Only reload the sound when something that changes it changed, so toggling
            // e.g. the screen option doesn't cut a song that is playing.
            const key = [fileKey(f), minP, maxP, minV, drums].join('|');
            const pb = sw.music_playback(midi, minP, maxP, minV, drums);
            try {
                if (key !== soundKey) {
                    player.load({
                        freqs: pb.frequencies, ms: pb.event_ms, tone: pb.event_tone,
                        on: pb.event_on, total: pb.total_ms,
                    });
                    soundKey = key;
                }
                $('music-info').textContent =
                    `${pb.frequencies.length} tone generators, ${mmss(pb.total_ms)}`;
            } finally {
                pb.free();
            }
            $('music-result').hidden = false;
            return 'Done';
        },
    });

    // ---- Insert data ----
    $('insert-btn').addEventListener('click', async () => {
        const status = $('insert-status');
        try {
            status.classList.remove('error');
            const s = drop_zones['structure-input']?.file, b = drop_zones['binary-input']?.file;
            if (!s) throw new Error('No structure selected!');
            if (!b) throw new Error('No binary file selected!');
            status.textContent = 'Working...';
            await new Promise(r => setTimeout(r, 0));
            const out = sw.insert_data(await bytesOf(s), await bytesOf(b), $('insert-name').value, $('insert-magic').value);
            download(out, `${stem(s)}.structure`);
            status.textContent = `Inserted ${b.size} bytes!`;
        } catch (e) {
            console.error(e);
            status.classList.add('error');
            status.textContent = `Error: ${msg(e)}`;
        }
    });
}

setup().catch(e => {
    console.error(e);
    $('version').textContent = `Failed to load wasm: ${msg(e)}`;
});
