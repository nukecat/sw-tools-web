// Plays what the tone generators of a generated music player do in the game: one sine wave per
// generator at a fixed frequency, switched on or off by the microcontroller. No envelope or
// filtering; the game only smooths the volume change a little, which is VOLUME_RAMP_S here.
// Events are scheduled just ahead of the audio clock.

// How long the volume of a tone generator takes to go from off to on (or back), as a straight
// line. This is a guess at the game's value: tune it by ear. 0 switches instantly.
const VOLUME_RAMP_S = 0.002;

const LOOKAHEAD_S = 0.4;
const PUMP_MS = 25;

export class TonePlayer {
    constructor() {
        this.ctx = null;
        this.data = null;
        this.volume = 0.4;
        this.loopFn = () => false;
        this.onstop = null;
        this.offset = 0;        // where playback starts / is parked, in ms
        this._timer = null;
        this._nodes = null;
    }

    get playing() { return this._nodes !== null; }
    get duration() { return this.data ? this.data.total : 0; }

    // freqs: Float32Array (Hz), ms/tone/on: parallel event arrays, total: ms
    load({ freqs, ms, tone, on, total }) {
        this.stop();
        this.offset = 0;
        // Keep the mix out of clipping: the loudest chord decides how loud a single voice is.
        let held = 0, maxHeld = 1;
        const state = new Uint8Array(freqs.length);
        for (let i = 0; i < ms.length; i++) {
            if (state[tone[i]] !== on[i]) { held += on[i] ? 1 : -1; state[tone[i]] = on[i]; }
            maxHeld = Math.max(maxHeld, held);
        }
        this.data = { freqs, ms, tone, on, total, voiceGain: Math.min(0.5, 1 / maxHeld) };
    }

    setVolume(v) {
        this.volume = v;
        if (this._nodes) this._nodes.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
    }

    // Position in ms, looping when the song loops.
    get position() {
        if (!this._nodes) return this.offset;
        const ms = Math.max(0, (this.ctx.currentTime - this._nodes.t0) * 1000);
        const total = this.data.total;
        return this.loopFn() ? ms % total : Math.min(ms, total);
    }

    // First event at or after `ms`.
    _indexAt(ms) {
        const a = this.data.ms;
        let lo = 0, hi = a.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (a[mid] < ms) lo = mid + 1; else hi = mid;
        }
        return lo;
    }

    // Starts scheduling from `ms` of the song, as of audio time `at`. Notes that are held down at
    // that point keep sounding, the way they would if the song had been playing all along.
    _startAt(ms, at) {
        const n = this._nodes, d = this.data;
        const idx = this._indexAt(ms);
        const held = new Uint8Array(d.freqs.length);
        for (let i = 0; i < idx; i++) held[d.tone[i]] = d.on[i];
        n.gains.forEach((g, i) => {
            const level = held[i] ? d.voiceGain : 0;
            g.gain.cancelScheduledValues(at);
            g.gain.setValueAtTime(level, at);
            n.ramps[i] = { from: level, to: level, at };
        });
        n.t0 = n.passStart = at - ms / 1000;
        n.idx = idx;
        n.finished = false;
    }

    // Jump to `ms`. While stopped this just moves the start point.
    seek(ms) {
        if (!this.data) return;
        ms = Math.min(Math.max(0, ms), Math.max(0, this.data.total - 1));
        this.offset = ms;
        if (!this._nodes) return;
        this._startAt(ms, this.ctx.currentTime);
        this._pump();
    }

    async play() {
        if (!this.data || this._nodes) return;
        this.ctx ??= new (window.AudioContext || window.webkitAudioContext)();
        await this.ctx.resume();
        const { ctx, data } = this;

        const master = ctx.createGain();
        master.gain.value = this.volume;
        master.connect(ctx.destination);
        const gains = [], oscs = [];
        for (const f of data.freqs) {
            const osc = ctx.createOscillator();   // sine is the default type
            osc.frequency.value = f;
            const g = ctx.createGain();
            g.gain.value = 0;
            osc.connect(g).connect(master);
            osc.start();
            oscs.push(osc);
            gains.push(g);
        }

        this._nodes = { master, gains, oscs, ramps: [], t0: 0, passStart: 0, idx: 0, finished: false, endT: 0 };
        this._startAt(this.offset, ctx.currentTime + 0.05);
        this._timer = setInterval(() => this._pump(), PUMP_MS);
        this._pump();
    }

    // Moves tone generator `i` to `target` starting at audio time `t`. If it is still part-way
    // through an earlier change, the new one starts from where it actually is.
    _setLevel(i, target, t) {
        const n = this._nodes, param = n.gains[i].gain, r = n.ramps[i];
        if (VOLUME_RAMP_S <= 0) {
            param.setValueAtTime(target, t);
            n.ramps[i] = { from: target, to: target, at: t };
            return;
        }
        const k = Math.min(1, Math.max(0, (t - r.at) / VOLUME_RAMP_S));
        const from = r.from + (r.to - r.from) * k;
        param.setValueAtTime(from, t);
        param.linearRampToValueAtTime(target, t + VOLUME_RAMP_S);
        n.ramps[i] = { from, to: target, at: t };
    }

    _pump() {
        const n = this._nodes, d = this.data;
        if (!n) return;
        const now = this.ctx.currentTime;
        if (n.finished) {
            if (now >= n.endT) this.stop();
            return;
        }
        const horizon = now + LOOKAHEAD_S;
        for (;;) {
            if (n.idx < d.ms.length) {
                const t = n.passStart + d.ms[n.idx] / 1000;
                if (t > horizon) break;
                this._setLevel(d.tone[n.idx], d.on[n.idx] ? d.voiceGain : 0, t);
                n.idx++;
            } else {
                const endT = n.passStart + d.total / 1000;
                if (endT > horizon) break;
                for (let i = 0; i < n.gains.length; i++) this._setLevel(i, 0, endT);   // the script releases every key
                if (this.loopFn()) {
                    n.passStart = endT;
                    n.idx = 0;
                } else {
                    n.finished = true;
                    n.endT = endT;
                    break;
                }
            }
        }
    }

    stop() {
        clearInterval(this._timer);
        this._timer = null;
        const n = this._nodes;
        if (!n) return;
        this._nodes = null;
        this.offset = 0;
        // Only the stop itself is faded (a few ms) so pressing Stop doesn't pop.
        const now = this.ctx.currentTime;
        n.master.gain.cancelScheduledValues(now);
        n.master.gain.setTargetAtTime(0, now, 0.005);
        setTimeout(() => {
            n.oscs.forEach(o => { try { o.stop(); } catch {} o.disconnect(); });
            n.gains.forEach(g => g.disconnect());
            n.master.disconnect();
        }, 80);
        this.onstop?.();
    }
}
