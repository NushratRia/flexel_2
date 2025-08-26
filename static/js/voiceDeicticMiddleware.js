/* static/js/voiceDeicticMiddleware.js
 * Two-hand deictic voice middleware + visual cues.
 *  - Handles "select/delete/write ... here/this" LOCALLY for BOTH hands (via DeicticRun + range:"this")
 *  - Shows HUD toasts like "Selected A2 & B4", "Deleted A2 & B4", "Wrote 50 → A2 & B4"
 *  - Very tolerant to ASR mishears: here/hear/hair/there/thiss/dis, right→write, etc.
 *  - Falls back to server, then to a legacy local parser for other commands.
 *
 * Requires (recommended):
 *  - static/js/bimanualPinchSelect.js (populates window.__lastTwoHandTargets)
 *  - static/js/deicticActionsBridge.js (provides window.DeicticRun that understands range:"this")
 * Optional:
 *  - global.DeicticToast.show(op, targets[, meta]) → nice HUD; otherwise a simple inline toast is used.
 */
(function (global) {
    'use strict';

    const DT  = global.DeicticTarget;

    // ---------- misc helpers ----------
    function clean(s){
        let t = String(s||'').trim();

        // drop wake words and common misfires
        t = t.replace(/^(?:hey|ok|okay)\s+(?:flexe?i?e?)\s*/i,'');
        t = t.replace(/^(?:flexe?i?e?),?\s*/i,'');
        t = t.replace(/^(?:play\s+se?a?\s+|play\s+see\s+|place\s+|plexi\s+|lexi\s+|sexy\s+)/i,'');

        // normalize words
        t = (' '+t.toLowerCase()+' ')
        .replace(/\sright\s/g,' write ')
        .replace(/\srite\s/g,' write ')
        .replace(/\ssea\s+salt\s/g,' sort ')
        .replace(/\ssee\s+salt\s/g,' sort ')
        .replace(/\s u\s/gi,' you ')
        .trim();

        // compress spaced digits: "5 0" -> "50", "1 2 3" -> "123"
        t = t.replace(/(\d)\s+(?=\d)/g, '$1');

        return t;
    }

    function colLetters(i){ let n=i,s=''; do{s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26)-1;}while(n>=0); return s; }

    // Prefer raw targets provided by bimanualPinchSelect (cell/row/col), else empty
    function getTwoHandTargets(){
        const T = global.__lastTwoHandTargets || {};
        const arr = [];
        if (T.L) arr.push(T.L);
        if (T.R) arr.push(T.R);
        return arr;
    }

    function labelForTarget(t){
        if (!t) return '';
        if (t.kind === 'cell') return `${colLetters(t.col)}${t.row+1}`;
        if (t.kind === 'row')  return `row ${t.rowIndex+1}`;
        if (t.kind === 'col')  return `col ${colLetters(t.colIndex)}`;
        return '';
    }

    // ---------- HUD / Toasts ----------
    function fallbackToast(msg){
        try{
        const id = 'vdm_toast';
        let el = document.getElementById(id);
        if (!el){
            el = document.createElement('div');
            el.id = id;
            Object.assign(el.style, {
            position:'fixed', left:'50%', top:'14px', transform:'translateX(-50%)',
            background:'rgba(20,20,20,0.92)', color:'#fff', font:'500 14px/1.3 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
            padding:'10px 14px', borderRadius:'10px', boxShadow:'0 6px 20px rgba(0,0,0,0.25)',
            zIndex: 2147483647, transition:'opacity 180ms ease',
            opacity:'0', pointerEvents:'none', whiteSpace:'nowrap'
            });
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.style.opacity = '1';
        clearTimeout(el.__t);
        el.__t = setTimeout(()=>{ el.style.opacity='0'; }, 1200);
        }catch(_){}
    }

    function showOpToast(op, value){
        const arr = getTwoHandTargets();
        if (arr.length === 0) return;

        // If a nicer HUD is available, use it
        if (global.DeicticToast && typeof global.DeicticToast.show === 'function') {
        const meta = value != null ? { value } : undefined;
        global.DeicticToast.show(op, arr, meta);
        return;
        }

        // Fallback: simple text toast
        const labels = arr.map(labelForTarget).filter(Boolean);
        if (!labels.length) return;

        let msg = '';
        if (op === 'selected') msg = `Selected ${labels.join(' & ')}`;
        else if (op === 'deleted') msg = `Deleted ${labels.join(' & ')}`;
        else if (op === 'wrote') msg = `Wrote ${value} \u2192 ${labels.join(' & ')}`;
        else msg = `${op} ${labels.join(' & ')}`;

        fallbackToast(msg);
    }

    const col      = () => (DT && DT.getColLetter && DT.getColLetter()) || null;
    const cell     = () => (DT && DT.getCellA1 && DT.getCellA1()) || null;
    const rowIndex = () => (DT && DT.getRowIndex && DT.getRowIndex()) || null;

    // ---------- TWO-HAND deictic local handler (runs actions immediately) ----------
    function maybeHandleLocalVoice(raw){
        if (!raw) return false;
        const s = clean(raw);

        // Accept many deictic mishears
        const deicticRe = /\b(this|here|there|hear|hair|thiss|dis)\b/;

        // SELECT both (useful for "select this")
        if ((/^select\b/.test(s) || /\bselect\b/.test(s)) && deicticRe.test(s)) {
        if (global.DeicticRun) {
            const ok = global.DeicticRun({ action:'select', range:'this' });
            if (ok) { showOpToast('selected'); return true; }
        }
        }

        // DELETE both selections
        if ((/\b(delete|clear|remove)\b/.test(s)) && deicticRe.test(s)) {
        if (global.DeicticRun) {
            const ok = global.DeicticRun({ action:'delete', range:'this' });
            if (ok) { showOpToast('deleted'); return true; }
        }
        }

        // WRITE value to both selections
        // Catches: "write 50 here", "put hello there", "fill 'x' this", "set 3.14 hear"
        const mWrite = s.match(/(?:^|\s)(?:write|put|fill|set)\s+(.+?)\s+(?:in|into|to|on|at)?\s*(?:this|here|there|hear|hair|thiss|dis)\b/);
        if (mWrite && mWrite[1]) {
        let value = mWrite[1].trim();
        value = value.replace(/^["']|["']$/g,''); // strip surrounding quotes
        if (global.DeicticRun) {
            const ok = global.DeicticRun({ action:'write', range:'this', value });
            if (ok) { showOpToast('wrote', value); return true; }
        }
        }

        return false;
    }
    // expose for other modules (e.g., voiceActions.js can call it pre-send)
    global.__maybeHandleLocalVoice = maybeHandleLocalVoice;

    // ---------- Legacy local parser (kept for non-deictic or single-target cases) ----------
    function parseLocal(raw){
        const s = clean(raw);

        // SELECT
        if (/^select\b/.test(s) || /\bselect\b/.test(s)){
        if (/\b(this|here)\b/.test(s)){
            return { action:'select', range:'this', confidence:0.9 };
        }
        }

        // SCROLL
        if (/^scroll\b/.test(s) || /\bscroll\b/.test(s) || /\bgo to\b/.test(s)){
        if (/\b(this|here)\b/.test(s)){
            const a1 = cell(); if (a1) return { action:'scroll', at:a1, confidence:0.9 };
            const ri = rowIndex(); if (ri || ri===0) return { action:'scroll', row:ri, confidence:0.85 };
        }
        const up = s.match(/\bscroll\s+up\s+(\d+)\b/);   if (up) return { action:'scroll', delta:-parseInt(up[1],10), confidence:0.85 };
        const dn = s.match(/\bscroll\s+down\s+(\d+)\b/); if (dn) return { action:'scroll', delta: parseInt(dn[1],10), confidence:0.85 };
        const r  = s.match(/\brow\s+(\d+)\b/);           if (r)  return { action:'scroll', row:parseInt(r[1],10), confidence:0.9 };
        const cM = s.match(/\bcolumn\s+([a-z]+)\b/i);    if (cM) return { action:'scroll', col:cM[1].toUpperCase(), confidence:0.9 };
        }

        // UNDO / REDO
        if (/^undo\b/.test(s)) return { action:'undo', confidence:0.95 };
        if (/^redo\b/.test(s)) return { action:'redo', confidence:0.95 };

        // DELETE (clear) — deictic → BOTH hands via "this"
        if (/^(delete|clear|remove)\b/.test(s) && /\b(this|here)\b/.test(s)){
        return { action:'delete', range:'this', confidence:0.92 };
        }

        // MERGE
        if (/^merge\b/.test(s)){
        if (/\b(this|here)\b/.test(s)){
            return { action:'merge', range:'this', confidence:0.85 };
        }
        const m = s.match(/\b([a-z]+\d+):([a-z]+\d+)\b/i);
        if (m) return { action:'merge', range:`${m[1].toUpperCase()}:${m[2].toUpperCase()}`, confidence:0.92 };
        }

        // ZOOM
        if (/^zoom\b/.test(s) || /\bzoom\b/.test(s)){
        if (/\bin\b/.test(s))   return { action:'zoom', direction:'in',    confidence:0.9 };
        if (/\bout\b/.test(s))  return { action:'zoom', direction:'out',   confidence:0.9 };
        if (/\breset\b/.test(s))return { action:'zoom', direction:'reset', confidence:0.9 };
        }

        // COPY
        if (/^copy\b/.test(s)){
        if (/\b(this|here)\b/.test(s)) return { action:'copy', range:'this', confidence:0.9 };
        const m = s.match(/\b([a-z]+\d+):([a-z]+\d+)\b/i);
        if (m) return { action:'copy', range:`${m[1].toUpperCase()}:${m[2].toUpperCase()}`, confidence:0.92 };
        }

        // PASTE
        if (/^paste\b/.test(s)){
        if (/\b(this|here)\b/.test(s)){
            const a1 = cell() || (col() ? `${col()}1` : null);
            if (a1) return { action:'paste', at:a1, confidence:0.9 };
        }
        const m = s.match(/\bat\s+([a-z]+\d+)\b/i);
        if (m) return { action:'paste', at:m[1].toUpperCase(), confidence:0.92 };
        }

        // SORT
        if (/^sort\b/.test(s)){
        const dir = /\bdesc(ending)?\b|\breverse\b|\blargest\b|\bhigh(est)?\b/.test(s) ? 'desc' : 'asc';
        let C = (s.match(/\bcolumn\s+([a-z]+)\b/i)||[])[1];
        if (!C) { const m = s.match(/^sort\s+([a-z]+)\b/i); if (m) C=m[1]; }
        if (!C && /\bthis\b/.test(s)) C = col();
        if (C) return { action:'sort', column:C.toUpperCase(), direction:dir, confidence:0.9 };
        }

        // WRITE (non-deictic fallback)
        if (/^write\b/.test(s)){
        const mInAt = s.match(/^write\s+(.+?)\s+(?:in|into|at)\s+([a-z]+\d+)\s*$/i);
        if (mInAt) return { action:'write', range:mInAt[2].toUpperCase(), value:mInAt[1].trim(), confidence:0.95 };

        const mHere = s.match(/^write\s+(.+?)\s+(?:here|this)\s*$/i);
        if (mHere){ return { action:'write', range:'this', value:mHere[1].trim(), confidence:0.92 }; }

        const mBare = s.match(/^write\s+(.+?)\s*$/i);
        if (mBare){ const a1 = cell() || (col()?`${col()}1`:null); if (a1) return { action:'write', range:a1, value:mBare[1].trim(), confidence:0.9 }; }
        }

        // Column aggregate shorthands on "this" column
        if (/^(sum|total)\b/.test(s) && /\bthis\b/.test(s) && col()){ const C=col(); return { action:'sum',     range:`${C}1:${C}9999`, confidence:0.9 }; }
        if (/^(average|mean)\b/.test(s) && /\bthis\b/.test(s) && col()){ const C=col(); return { action:'average', range:`${C}1:${C}9999`, confidence:0.9 }; }

        return null;
    }

    // ---------- Wrap fetch('/api/voice-command') ----------
    const _fetch = global.fetch.bind(global);

    global.fetch = async function(input, init){
        const url = (typeof input === 'string') ? input : (input && input.url);
        const isVoice = /\/api\/voice-command$/.test(url || '');
        if (!isVoice) return _fetch(input, init);

        // Extract raw transcript (if present) and CLEAN it for server
        let rawTranscript = null;
        try {
        if (init && typeof init.body === 'string') {
            const parsed = JSON.parse(init.body);
            rawTranscript = parsed && parsed.transcript;
            if (rawTranscript) {
            init = { ...init, body: JSON.stringify({ transcript: clean(rawTranscript) }) };
            }
        }
        } catch (_) {}

        // 1) Try LOCAL two-hand deictic first (applies BOTH selections immediately)
        try {
        if (rawTranscript && maybeHandleLocalVoice(rawTranscript)) {
            // Already executed the action locally; return a benign JSON
            return new Response(
            JSON.stringify({ result: { action:'none', confidence:1.0, handledLocally:true } }),
            { status:200, headers:{'Content-Type':'application/json'} }
            );
        }
        } catch (e) {
        console.warn('[VoiceDeicticMiddleware] local pre-send handler error:', e);
        }

        // 2) Ask the server
        const res = await _fetch(input, init);

        // 3) If server declines (action:none), try local fallbacks
        try {
        const clone   = res.clone();
        const payload = await clone.json().catch(()=>null);
        const cmd     = payload && (payload.result || payload);

        // If server produced a command, pass it through
        if (cmd && cmd.action && cmd.action !== 'none') return res;

        // Otherwise: two-tier fallback
        // 3a) Try two-hand deictic again (in case we couldn't run it pre-send)
        if (rawTranscript && maybeHandleLocalVoice(rawTranscript)) {
            return new Response(
            JSON.stringify({ result: { action:'none', confidence:1.0, handledLocally:true } }),
            { status:200, headers:{'Content-Type':'application/json'} }
            );
        }

        // 3b) Legacy single-target local parse (kept for other ops)
        const local = parseLocal(rawTranscript || '');
        if (local && local.action && (local.confidence ?? 0) >= 0.55) {
            return new Response(
            JSON.stringify({ result: local }),
            { status:200, headers:{'Content-Type':'application/json'} }
            );
        }
        return res;
        } catch (e) {
        console.warn('[VoiceDeicticMiddleware] post-server local handling error:', e);
        return res;
        }
    };

    console.info('[VoiceDeicticMiddleware] ready (two-hand deictic + HUD toasts).');
})(window);


















// /* static/js/voiceDeicticMiddleware.js
//  * Intercept simple deictic commands locally so one command hits BOTH hands.
//  * Falls back to server if no local match.
//  */
// (function (global) {
//     'use strict';

//     // call this with raw ASR text; return true if handled locally
//     function handleLocalVoice(text){
//         if (!text) return false;
//         const s = String(text).trim().toLowerCase();

//         // common ASR variants for "here/this"
//         const deictic = ['this','here','there','hear','hare','hair'];

//         // delete this/here
//         if (/^(delete|clear)\s+(\w+)$/.test(s)) {
//         const word = s.split(/\s+/).pop();
//         if (deictic.includes(word)) {
//             return !!(global.DeicticRun && global.DeicticRun({ action:'delete', range:'this' }));
//         }
//         }

//         // write/put/fill <value> here/this
//         const m = s.match(/^(write|put|fill|set)\s+(.+?)\s+(\w+)$/);
//         if (m) {
//         const value = m[2];
//         const where = m[3];
//         if (deictic.includes(where)) {
//             return !!(global.DeicticRun && global.DeicticRun({ action:'write', range:'this', value }));
//         }
//         }

//         return false;
//     }

//     // Wire into your existing voice path if available
//     global.__maybeHandleLocalVoice = handleLocalVoice;
//     console.info('[VoiceDeicticMiddleware] Ready (local deictic → BOTH selections).');

// })(window);





// /* static/js/voiceDeicticMiddleware.js */
// (function (global) {
//     'use strict';
//     const DT = global.DeicticTarget;

//     // ---------- helpers ----------
//     function clean(s){
//         // strip hotword and common mishears
//         let t = String(s||'').trim();
//         t = t.replace(/^(?:hey|ok|okay)\s+(?:flexe?i?e?)\s*/i,'');
//         t = t.replace(/^(?:flexe?i?e?),?\s*/i,'');
//         t = t.replace(/^(?:play\s+se?a?\s+|play\s+see\s+|place\s+|plexi\s+|lexi\s+|sexy\s+)/i,'');
//         // normalize words
//         t = (' '+t.toLowerCase()+' ')
//         .replace(/\sright\s/g,' write ')
//         .replace(/\srite\s/g,' write ')
//         .replace(/\ssea\s+salt\s/g,' sort ')
//         .replace(/\ssee\s+salt\s/g,' sort ')
//         .trim();
//         // compress spaced digits ("5 0" -> "50")
//         t = t.replace(/\b(\d)\s+(\d)\b/g,(_,a,b)=>a+b);
//         return t;
//     }
//     const col = () => (DT && DT.getColLetter && DT.getColLetter()) || null;
//     const cell = () => (DT && DT.getCellA1 && DT.getCellA1()) || null;
//     const rowIndex = () => (DT && DT.getRowIndex && DT.getRowIndex()) || null;

//     // Build a local command object for all supported actions
//     function parseLocal(raw){
//         const s = clean(raw);

//         // SELECT
//         if (/^select\b/.test(s) || /\bselect\b/.test(s)){
//         // select this / select here
//         if (/\b(this|here)\b/.test(s)){
//             const a1 = cell();
//             if (a1) return { action:'select', range:a1, confidence:0.9 };
//             const c = col(); if (c) return { action:'select', range:`${c}:${c}`, confidence:0.85 };
//         }
//         }

//         // SCROLL
//         if (/^scroll\b/.test(s) || /\bscroll\b/.test(s) || /\bgo to\b/.test(s)){
//         // "scroll to this" / "go to this"
//         if (/\b(this|here)\b/.test(s)){
//             const a1 = cell(); if (a1) return { action:'scroll', at:a1, confidence:0.9 };
//             const ri = rowIndex(); if (ri) return { action:'scroll', row:ri, confidence:0.85 };
//         }
//         // up/down N
//         const up = s.match(/\bscroll\s+up\s+(\d+)\b/); if (up) return { action:'scroll', delta:-parseInt(up[1],10), confidence:0.85 };
//         const dn = s.match(/\bscroll\s+down\s+(\d+)\b/); if (dn) return { action:'scroll', delta:parseInt(dn[1],10), confidence:0.85 };
//         // to row N / column C
//         const r = s.match(/\brow\s+(\d+)\b/); if (r) return { action:'scroll', row:parseInt(r[1],10), confidence:0.9 };
//         const c = s.match(/\bcolumn\s+([a-z]+)\b/i); if (c) return { action:'scroll', col:c[1].toUpperCase(), confidence:0.9 };
//         }

//         // UNDO / REDO
//         if (/^undo\b/.test(s)) return { action:'undo', confidence:0.95 };
//         if (/^redo\b/.test(s)) return { action:'redo', confidence:0.95 };

//         // DELETE (clear)
//         if (/^(delete|clear)\b/.test(s)){
//         // delete this / here
//         if (/\b(this|here)\b/.test(s)){
//             const a1 = cell(); if (a1) return { action:'delete', range:a1, confidence:0.92 };
//             const c = col(); if (c) return { action:'delete', range:`${c}:${c}`, confidence:0.9 };
//         }
//         }

//         // MERGE
//         if (/^merge\b/.test(s)){
//         if (/\b(this|here)\b/.test(s)){
//             // Merge current selection; if only a cell, no-op
//             return { action:'merge', range:'this', confidence:0.85 };
//         }
//         const m = s.match(/\b([a-z]+\d+):([a-z]+\d+)\b/i);
//         if (m) return { action:'merge', range:`${m[1].toUpperCase()}:${m[2].toUpperCase()}`, confidence:0.92 };
//         }

//         // ZOOM
//         if (/^zoom\b/.test(s) || /\bzoom\b/.test(s)){
//         if (/\bin\b/.test(s)) return { action:'zoom', direction:'in', confidence:0.9 };
//         if (/\bout\b/.test(s)) return { action:'zoom', direction:'out', confidence:0.9 };
//         if (/\breset\b/.test(s)) return { action:'zoom', direction:'reset', confidence:0.9 };
//         }

//         // COPY
//         if (/^copy\b/.test(s)){
//         if (/\b(this|here)\b/.test(s)){
//             const a1 = cell(); if (a1) return { action:'copy', range:a1, confidence:0.9 };
//             const c = col();  if (c)  return { action:'copy', range:`${c}:${c}`, confidence:0.9 };
//         }
//         const m = s.match(/\b([a-z]+\d+):([a-z]+\d+)\b/i);
//         if (m) return { action:'copy', range:`${m[1].toUpperCase()}:${m[2].toUpperCase()}`, confidence:0.92 };
//         }

//         // PASTE
//         if (/^paste\b/.test(s)){
//         // paste here / paste at this
//         if (/\b(this|here)\b/.test(s)){
//             const a1 = cell() || (col() ? `${col()}1` : null);
//             if (a1) return { action:'paste', at:a1, confidence:0.9 };
//         }
//         const m = s.match(/\bat\s+([a-z]+\d+)\b/i);
//         if (m) return { action:'paste', at:m[1].toUpperCase(), confidence:0.92 };
//         }

//         // SORT + WRITE + SUM + AVERAGE already covered (but keep them too if you used earlier version)
//         if (/^sort\b/.test(s)){
//         const dir = /\bdesc(ending)?\b|\breverse\b|\blargest\b|\bhigh(est)?\b/.test(s) ? 'desc' : 'asc';
//         let C = (s.match(/\bcolumn\s+([a-z]+)\b/i)||[])[1];
//         if (!C) { const m = s.match(/^sort\s+([a-z]+)\b/i); if (m) C=m[1]; }
//         if (!C && /\bthis\b/.test(s)) C = col();
//         if (C) return { action:'sort', column:C.toUpperCase(), direction:dir, confidence:0.9 };
//         }
//         if (/^write\b/.test(s)){
//         const mInAt = s.match(/^write\s+(.+?)\s+(?:in|into|at)\s+([a-z]+\d+)\s*$/i);
//         if (mInAt) return { action:'write', range:mInAt[2].toUpperCase(), value:mInAt[1].trim(), confidence:0.95 };
//         const mHere = s.match(/^write\s+(.+?)\s+(?:here|this)\s*$/i);
//         if (mHere){ const a1 = cell() || (col()?`${col()}1`:null); if (a1) return { action:'write', range:a1, value:mHere[1].trim(), confidence:0.92 }; }
//         const mBare = s.match(/^write\s+(.+?)\s*$/i);
//         if (mBare){ const a1 = cell() || (col()?`${col()}1`:null); if (a1) return { action:'write', range:a1, value:mBare[1].trim(), confidence:0.9 }; }
//         }
//         if (/^(sum|total)\b/.test(s) && /\bthis\b/.test(s) && col()){ const C=col(); return { action:'sum', range:`${C}1:${C}9999`, confidence:0.9 }; }
//         if (/^(average|mean)\b/.test(s) && /\bthis\b/.test(s) && col()){ const C=col(); return { action:'average', range:`${C}1:${C}9999`, confidence:0.9 }; }

//         return null;
//     }

//     // Wrap fetch('/api/voice-command')
//     const _fetch = global.fetch.bind(global);
//     global.fetch = async function(input, init){
//         const url = (typeof input === 'string') ? input : (input && input.url);
//         if (!/\/api\/voice-command$/.test(url || '')) return _fetch(input, init);

//         // send cleaned transcript to server
//         let transcript = null;
//         try {
//         if (init && typeof init.body === 'string') {
//             const parsed = JSON.parse(init.body);
//             transcript = parsed && parsed.transcript;
//             if (transcript) init = { ...init, body: JSON.stringify({ transcript: clean(transcript) }) };
//         }
//         } catch (_) {}

//         const res = await _fetch(input, init);

//         try {
//         const clone = res.clone();
//         const payload = await clone.json().catch(()=>null);
//         const cmd = payload && (payload.result || payload);

//         if (cmd && cmd.action && cmd.action !== 'none') return res;

//         const local = parseLocal(transcript || '');
//         if (local && local.action && local.confidence >= 0.55) {
//             return new Response(JSON.stringify({ result: local }), { status:200, headers:{'Content-Type':'application/json'} });
//         }
//         return res;
//         } catch (_) {
//         return res;
//         }
//     };

//     console.info('[VoiceDeicticMiddleware] ready for select/scroll/undo/redo/delete/merge/zoom/copy/paste.');
// })(window);
