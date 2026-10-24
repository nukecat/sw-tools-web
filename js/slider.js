export const sliders = {};

// A slider has two ranges:
//   data-min / data-max            what the slider itself can reach
//   data-hard-min / data-hard-max  what the number box accepts (defaults to the slider range)
// Typing in the number box is not touched until it is committed (Enter, Tab, click away or the
// arrow keys); only then is the value checked and clamped to the hard range.
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-slider]').forEach(el => {
        const key   = el.dataset.slider;
        const min   = Number(el.dataset.min);
        const max   = Number(el.dataset.max);
        const hardMin = Number(el.dataset.hardMin ?? min);
        const hardMax = Number(el.dataset.hardMax ?? max);
        const step  = Number(el.dataset.step ?? 1);
        const def   = Number(el.dataset.default);
        const label = el.dataset.label ?? key;

        const labelEl   = el.querySelector('.label');
        const minSpan   = el.querySelector('.min');
        const maxSpan   = el.querySelector('.max');
        const numberEl  = el.querySelector('input[type="number"]');
        const rangeEl   = el.querySelector('input[type="range"]');

        if (labelEl) labelEl.textContent = label;
        if (minSpan) minSpan.textContent = min;
        if (maxSpan) maxSpan.textContent = max;

        rangeEl.min = min;
        rangeEl.max = max;
        rangeEl.step = step;
        // The box only steps with the arrow keys; its own limits are the hard ones.
        numberEl.min = hardMin;
        numberEl.max = hardMax;
        numberEl.step = step;

        // Whole-step sliders (pitch, velocity) stay integers; fractional ones keep what was typed.
        const clean = v => (Number.isInteger(step) ? Math.round(v) : Number(v.toFixed(6)));
        const clamp = v => Math.min(hardMax, Math.max(hardMin, clean(v)));

        let current = def;   // the last committed value; this is what the app reads

        function show(v) {
            current = v;
            numberEl.value = v;
            rangeEl.value = v;   // the browser pins the thumb to the slider's own ends
        }

        function commit() {
            const raw = numberEl.value.trim();
            const v = raw === '' ? NaN : Number(raw);
            show(Number.isFinite(v) ? clamp(v) : current);
        }

        // Slider drag: always inside the slider range
        rangeEl.addEventListener('input', () => {
            current = Number(rangeEl.value);
            numberEl.value = rangeEl.value;
        });

        // Typing is private until committed: hide it from listeners that would convert.
        numberEl.addEventListener('input', e => {
            if (e.inputType) { e.stopPropagation(); return; }   // typed / pasted / deleted text
            commit();                                           // arrow keys step the value
        });
        numberEl.addEventListener('change', commit);            // fires on Enter and on blur
        numberEl.addEventListener('keydown', e => {
            if (e.key === 'Enter') { commit(); numberEl.blur(); }
            else if (e.key === 'Escape') { numberEl.value = current; numberEl.blur(); }
        });

        // Clicking or tabbing into the box selects the whole number.
        let justFocused = false;
        numberEl.addEventListener('focus', () => { justFocused = true; numberEl.select(); });
        numberEl.addEventListener('mouseup', e => { if (justFocused) e.preventDefault(); justFocused = false; });
        numberEl.addEventListener('blur', () => { justFocused = false; });

        show(def);
        sliders[key] = () => current;
        // Lets the reset button put the default back without going through the events
        el.sliderReset = () => show(def);
    });
});

export function resetSliders(root = document) {
    root.querySelectorAll('[data-slider]').forEach(el => el.sliderReset?.());
}
