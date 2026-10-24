// Replaces a native <select> with a dropdown that matches the page and, for long lists, can be
// searched. The <select> stays in the DOM (hidden) and remains the source of truth, so the rest
// of the code keeps using select.value and listening for its `change` event.
//
// After changing the options or the value from code, call syncCombo(select).

const SEARCH_FROM = 9;   // lists with at least this many options get a search box
let openCombo = null;

export function syncCombo(select) {
    select._combo?.sync();
}

export function enhanceSelect(select) {
    if (select._combo) { select._combo.sync(); return; }

    const wrap = document.createElement('span');
    wrap.className = 'combo';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'combo-btn';
    btn.setAttribute('aria-haspopup', 'listbox');
    const label = document.createElement('span');
    label.className = 'combo-label';
    const caret = document.createElement('span');
    caret.className = 'combo-caret';
    caret.textContent = '\u25BE';
    btn.append(label, caret);
    wrap.append(btn);
    select.after(wrap);
    select.hidden = true;

    let menu = null, list = null, search = null, items = [], active = -1;

    const optionsOf = () => [...select.options].filter(o => !o.disabled);
    const sync = () => {
        label.textContent = select.selectedOptions[0]?.textContent ?? '';
    };

    function setActive(i, scroll = true) {
        items.forEach(li => li.classList.remove('active'));
        active = i;
        const li = items[i];
        if (!li) return;
        li.classList.add('active');
        if (scroll) li.scrollIntoView({ block: 'nearest' });
    }

    function render() {
        const q = (search?.value ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
        list.textContent = '';
        items = [];
        for (const o of optionsOf()) {
            const text = o.textContent.toLowerCase();
            if (!q.every(t => text.includes(t))) continue;
            const li = document.createElement('li');
            li.className = 'combo-opt' + (o.value === select.value ? ' selected' : '');
            li.setAttribute('role', 'option');
            li.dataset.value = o.value;
            li.textContent = o.textContent;
            items.push(li);
            list.append(li);
        }
        if (!items.length) {
            const li = document.createElement('li');
            li.className = 'combo-empty';
            li.textContent = 'No matches';
            list.append(li);
        }
        const sel = items.findIndex(li => li.classList.contains('selected'));
        setActive(q.length ? 0 : sel, !q.length);
    }

    function place() {
        const r = btn.getBoundingClientRect();
        const below = window.innerHeight - r.bottom - 12;
        const above = r.top - 12;
        const up = below < 220 && above > below;
        const room = Math.max(120, up ? above : below);
        menu.style.minWidth = `${Math.max(r.width, 240)}px`;
        menu.style.maxHeight = `${Math.min(360, room)}px`;
        const left = Math.min(r.left, window.innerWidth - menu.offsetWidth - 8);
        menu.style.left = `${Math.max(8, left)}px`;
        if (up) { menu.style.top = ''; menu.style.bottom = `${window.innerHeight - r.top + 4}px`; }
        else { menu.style.bottom = ''; menu.style.top = `${r.bottom + 4}px`; }
    }

    function choose(value) {
        close();
        if (value !== select.value) {
            select.value = value;
            sync();
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        btn.focus();
    }

    function open() {
        if (openCombo && openCombo !== close) openCombo();
        menu = document.createElement('div');
        menu.className = 'combo-menu';
        if (optionsOf().length >= SEARCH_FROM) {
            search = document.createElement('input');
            search.type = 'text';
            search.className = 'combo-search';
            search.placeholder = 'Search...';
            search.autocomplete = 'off';
            search.spellcheck = false;
            search.addEventListener('input', render);
            menu.append(search);
        }
        list = document.createElement('ul');
        list.className = 'combo-list';
        list.setAttribute('role', 'listbox');
        list.tabIndex = -1;
        menu.append(list);
        document.body.append(menu);
        render();
        place();
        btn.setAttribute('aria-expanded', 'true');
        wrap.classList.add('open');
        (search ?? list).focus({ preventScroll: true });

        menu.addEventListener('pointermove', e => {
            const li = e.target.closest('.combo-opt');
            if (li) setActive(items.indexOf(li), false);
        });
        menu.addEventListener('click', e => {
            const li = e.target.closest('.combo-opt');
            if (li) choose(li.dataset.value);
        });
        menu.addEventListener('keydown', onKey);
        document.addEventListener('pointerdown', onOutside, true);
        window.addEventListener('resize', close);
        window.addEventListener('scroll', onScroll, true);
        openCombo = close;
    }

    function close() {
        if (!menu) return;
        menu.remove();
        menu = list = search = null;
        items = [];
        btn.removeAttribute('aria-expanded');
        wrap.classList.remove('open');
        document.removeEventListener('pointerdown', onOutside, true);
        window.removeEventListener('resize', close);
        window.removeEventListener('scroll', onScroll, true);
        if (openCombo === close) openCombo = null;
    }

    const onOutside = e => { if (!menu?.contains(e.target) && !btn.contains(e.target)) close(); };
    const onScroll = e => { if (menu && !menu.contains(e.target)) close(); };

    function onKey(e) {
        const n = items.length;
        if (e.key === 'ArrowDown') { e.preventDefault(); if (n) setActive((active + 1) % n); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); if (n) setActive((active - 1 + n) % n); }
        else if (e.key === 'PageDown') { e.preventDefault(); if (n) setActive(Math.min(n - 1, active + 8)); }
        else if (e.key === 'PageUp') { e.preventDefault(); if (n) setActive(Math.max(0, active - 8)); }
        else if (e.key === 'Home' && !search) { e.preventDefault(); setActive(0); }
        else if (e.key === 'End' && !search) { e.preventDefault(); setActive(n - 1); }
        else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) choose(items[active].dataset.value); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); btn.focus(); }
        else if (e.key === 'Tab') close();
    }

    btn.addEventListener('click', () => (menu ? close() : open()));
    btn.addEventListener('keydown', e => {
        if (['ArrowDown', 'ArrowUp'].includes(e.key) && !menu) { e.preventDefault(); open(); }
    });
    select.addEventListener('sync', sync);

    select._combo = { sync, close };
    sync();
}
