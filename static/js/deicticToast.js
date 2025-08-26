/* static/js/deicticToast.js
 * Minimal toast HUD that can describe actions on TWO deictic targets.
 * Export: window.DeicticToast.show(action, targets, opts?)
 *   - action: "selected" | "deleted" | "write"
 *   - targets: array of strings OR {kind:'cell'|'row'|'col', row?, col?, rowIndex?, colIndex?}
 *   - opts.value: for write -> value to show
 *   - opts.final: optional final range text (e.g., "A2:B4", "columns C–F", "rows 2–4")
 */
(function (global) {
    'use strict';

    // ---------- DOM skeleton ----------
    let root = document.getElementById('deictic-toast-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'deictic-toast-root';
        Object.assign(root.style, {
        position: 'fixed',
        left: '50%',
        bottom: '18px',
        transform: 'translateX(-50%)',
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        pointerEvents: 'none',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif'
        });
        document.body.appendChild(root);
    }

    const styleId = 'deictic-toast-style';
    if (!document.getElementById(styleId)) {
        const css = document.createElement('style');
        css.id = styleId;
        css.textContent = `
        .deictic-toast {
            background: rgba(16,16,24,.92);
            color: #f0f3f9;
            border: 1px solid rgba(255,255,255,.12);
            border-radius: 10px;
            box-shadow: 0 4px 26px rgba(0,0,0,.35);
            padding: 8px 12px;
            font-size: 13px;
            line-height: 1.25;
            letter-spacing: .2px;
            opacity: 0;
            transform: translateY(4px);
            transition: opacity .15s ease, transform .15s ease;
            max-width: 70vw;
            text-wrap: pretty;
        }
        .deictic-toast.show {
            opacity: 1;
            transform: translateY(0);
        }
        .deictic-toast .dim { opacity: .7; }
        .deictic-toast b { font-weight: 600; }
        @media (prefers-color-scheme: light) {
            .deictic-toast { background: rgba(250,250,252,.98); color:#1d212a; border-color: rgba(0,0,0,.08); }
        }
        `;
        document.head.appendChild(css);
    }

    // ---------- format helpers ----------
    function colLetters(i){ let n=i,s=''; do{s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26)-1;}while(n>=0); return s; }
    function a1FromRC(r, c){ return `${colLetters(c)}${r+1}`; }

    function labelFor(t){
        if (!t) return '?';
        if (typeof t === 'string') return t.toUpperCase();

        const k = t.kind;
        if (k === 'cell') {
        const r = (t.row != null) ? t.row : t.r;
        const c = (t.col != null) ? t.col : t.c;
        if (r != null && c != null) return a1FromRC(r, c);
        }
        if (k === 'row') {
        const ri = (t.rowIndex != null) ? t.rowIndex : t.r;
        if (ri != null) return `row ${ri+1}`;
        }
        if (k === 'col') {
        const ci = (t.colIndex != null) ? t.colIndex : t.c;
        if (ci != null) return `column ${colLetters(ci)}`;
        }
        return '?';
    }

    function pastTense(action){
        if (!action) return '';
        const a = action.toLowerCase();
        if (a === 'write')  return 'Wrote';
        if (a === 'delete' || a === 'deleted' || a === 'clear' || a === 'removed') return 'Deleted';
        if (a === 'select' || a === 'selected') return 'Selected';
        return a.charAt(0).toUpperCase() + a.slice(1);
    }

    function joinTargets(labels){
        labels = labels.filter(Boolean);
        if (labels.length === 0) return '';
        if (labels.length === 1) return labels[0];
        if (labels.length === 2) return `${labels[0]} & ${labels[1]}`;
        return labels.slice(0,2).join(' & ') + ` +${labels.length-2}`;
    }

    // ---------- show ----------
    function show(action, targets, opts){
        try {
        const labels = (targets || []).map(labelFor);
        const verb = pastTense(action);
        const parts = [];

        if (verb === 'Wrote' && opts && 'value' in opts) {
            parts.push(`${verb} ${String(opts.value)}`);
            const jt = joinTargets(labels);
            if (jt) parts.push(`to ${jt}`);
        } else {
            parts.push(verb);
            const jt = joinTargets(labels);
            if (jt) parts.push(jt);
        }

        if (opts && opts.final) {
            parts.push(`<span class="dim">→</span> <b>${String(opts.final).toUpperCase()}</b>`);
        }

        const el = document.createElement('div');
        el.className = 'deictic-toast';
        el.innerHTML = parts.join(' ');
        root.appendChild(el);
        requestAnimationFrame(()=>el.classList.add('show'));

        // auto-remove
        const ttl = (opts && opts.ttl) || 1600;
        setTimeout(()=>{
            el.classList.remove('show');
            setTimeout(()=>el.remove(), 180);
        }, ttl);
        } catch (e) {
        console.warn('[DeicticToast] show failed', e);
        }
    }

    global.DeicticToast = { show };
    console.info('[DeicticToast] ready.');
})(window);
