/* static/js/voiceDeicticMiddleware.js */
(function (global) {
    'use strict';
    const DT = global.DeicticTarget;

    // ---------- helpers ----------
    function clean(s){
        // strip hotword and common mishears
        let t = String(s||'').trim();
        t = t.replace(/^(?:hey|ok|okay)\s+(?:flexe?i?e?)\s*/i,'');
        t = t.replace(/^(?:flexe?i?e?),?\s*/i,'');
        t = t.replace(/^(?:play\s+se?a?\s+|play\s+see\s+|place\s+|plexi\s+|lexi\s+|sexy\s+)/i,'');
        // normalize words
        t = (' '+t.toLowerCase()+' ')
        .replace(/\sright\s/g,' write ')
        .replace(/\srite\s/g,' write ')
        .replace(/\ssea\s+salt\s/g,' sort ')
        .replace(/\ssee\s+salt\s/g,' sort ')
        .trim();
        // compress spaced digits ("5 0" -> "50")
        t = t.replace(/\b(\d)\s+(\d)\b/g,(_,a,b)=>a+b);
        return t;
    }
    const col = () => (DT && DT.getColLetter && DT.getColLetter()) || null;
    const cell = () => (DT && DT.getCellA1 && DT.getCellA1()) || null;
    const rowIndex = () => (DT && DT.getRowIndex && DT.getRowIndex()) || null;

    // Build a local command object for all supported actions
    function parseLocal(raw){
        const s = clean(raw);

        // SELECT
        if (/^select\b/.test(s) || /\bselect\b/.test(s)){
        // select this / select here
        if (/\b(this|here)\b/.test(s)){
            const a1 = cell();
            if (a1) return { action:'select', range:a1, confidence:0.9 };
            const c = col(); if (c) return { action:'select', range:`${c}:${c}`, confidence:0.85 };
        }
        }

        // SCROLL
        if (/^scroll\b/.test(s) || /\bscroll\b/.test(s) || /\bgo to\b/.test(s)){
        // "scroll to this" / "go to this"
        if (/\b(this|here)\b/.test(s)){
            const a1 = cell(); if (a1) return { action:'scroll', at:a1, confidence:0.9 };
            const ri = rowIndex(); if (ri) return { action:'scroll', row:ri, confidence:0.85 };
        }
        // up/down N
        const up = s.match(/\bscroll\s+up\s+(\d+)\b/); if (up) return { action:'scroll', delta:-parseInt(up[1],10), confidence:0.85 };
        const dn = s.match(/\bscroll\s+down\s+(\d+)\b/); if (dn) return { action:'scroll', delta:parseInt(dn[1],10), confidence:0.85 };
        // to row N / column C
        const r = s.match(/\brow\s+(\d+)\b/); if (r) return { action:'scroll', row:parseInt(r[1],10), confidence:0.9 };
        const c = s.match(/\bcolumn\s+([a-z]+)\b/i); if (c) return { action:'scroll', col:c[1].toUpperCase(), confidence:0.9 };
        }

        // UNDO / REDO
        if (/^undo\b/.test(s)) return { action:'undo', confidence:0.95 };
        if (/^redo\b/.test(s)) return { action:'redo', confidence:0.95 };

        // DELETE (clear)
        if (/^(delete|clear)\b/.test(s)){
        // delete this / here
        if (/\b(this|here)\b/.test(s)){
            const a1 = cell(); if (a1) return { action:'delete', range:a1, confidence:0.92 };
            const c = col(); if (c) return { action:'delete', range:`${c}:${c}`, confidence:0.9 };
        }
        }

        // MERGE
        if (/^merge\b/.test(s)){
        if (/\b(this|here)\b/.test(s)){
            // Merge current selection; if only a cell, no-op
            return { action:'merge', range:'this', confidence:0.85 };
        }
        const m = s.match(/\b([a-z]+\d+):([a-z]+\d+)\b/i);
        if (m) return { action:'merge', range:`${m[1].toUpperCase()}:${m[2].toUpperCase()}`, confidence:0.92 };
        }

        // ZOOM
        if (/^zoom\b/.test(s) || /\bzoom\b/.test(s)){
        if (/\bin\b/.test(s)) return { action:'zoom', direction:'in', confidence:0.9 };
        if (/\bout\b/.test(s)) return { action:'zoom', direction:'out', confidence:0.9 };
        if (/\breset\b/.test(s)) return { action:'zoom', direction:'reset', confidence:0.9 };
        }

        // COPY
        if (/^copy\b/.test(s)){
        if (/\b(this|here)\b/.test(s)){
            const a1 = cell(); if (a1) return { action:'copy', range:a1, confidence:0.9 };
            const c = col();  if (c)  return { action:'copy', range:`${c}:${c}`, confidence:0.9 };
        }
        const m = s.match(/\b([a-z]+\d+):([a-z]+\d+)\b/i);
        if (m) return { action:'copy', range:`${m[1].toUpperCase()}:${m[2].toUpperCase()}`, confidence:0.92 };
        }

        // PASTE
        if (/^paste\b/.test(s)){
        // paste here / paste at this
        if (/\b(this|here)\b/.test(s)){
            const a1 = cell() || (col() ? `${col()}1` : null);
            if (a1) return { action:'paste', at:a1, confidence:0.9 };
        }
        const m = s.match(/\bat\s+([a-z]+\d+)\b/i);
        if (m) return { action:'paste', at:m[1].toUpperCase(), confidence:0.92 };
        }

        // SORT + WRITE + SUM + AVERAGE already covered (but keep them too if you used earlier version)
        if (/^sort\b/.test(s)){
        const dir = /\bdesc(ending)?\b|\breverse\b|\blargest\b|\bhigh(est)?\b/.test(s) ? 'desc' : 'asc';
        let C = (s.match(/\bcolumn\s+([a-z]+)\b/i)||[])[1];
        if (!C) { const m = s.match(/^sort\s+([a-z]+)\b/i); if (m) C=m[1]; }
        if (!C && /\bthis\b/.test(s)) C = col();
        if (C) return { action:'sort', column:C.toUpperCase(), direction:dir, confidence:0.9 };
        }
        if (/^write\b/.test(s)){
        const mInAt = s.match(/^write\s+(.+?)\s+(?:in|into|at)\s+([a-z]+\d+)\s*$/i);
        if (mInAt) return { action:'write', range:mInAt[2].toUpperCase(), value:mInAt[1].trim(), confidence:0.95 };
        const mHere = s.match(/^write\s+(.+?)\s+(?:here|this)\s*$/i);
        if (mHere){ const a1 = cell() || (col()?`${col()}1`:null); if (a1) return { action:'write', range:a1, value:mHere[1].trim(), confidence:0.92 }; }
        const mBare = s.match(/^write\s+(.+?)\s*$/i);
        if (mBare){ const a1 = cell() || (col()?`${col()}1`:null); if (a1) return { action:'write', range:a1, value:mBare[1].trim(), confidence:0.9 }; }
        }
        if (/^(sum|total)\b/.test(s) && /\bthis\b/.test(s) && col()){ const C=col(); return { action:'sum', range:`${C}1:${C}9999`, confidence:0.9 }; }
        if (/^(average|mean)\b/.test(s) && /\bthis\b/.test(s) && col()){ const C=col(); return { action:'average', range:`${C}1:${C}9999`, confidence:0.9 }; }

        return null;
    }

    // Wrap fetch('/api/voice-command')
    const _fetch = global.fetch.bind(global);
    global.fetch = async function(input, init){
        const url = (typeof input === 'string') ? input : (input && input.url);
        if (!/\/api\/voice-command$/.test(url || '')) return _fetch(input, init);

        // send cleaned transcript to server
        let transcript = null;
        try {
        if (init && typeof init.body === 'string') {
            const parsed = JSON.parse(init.body);
            transcript = parsed && parsed.transcript;
            if (transcript) init = { ...init, body: JSON.stringify({ transcript: clean(transcript) }) };
        }
        } catch (_) {}

        const res = await _fetch(input, init);

        try {
        const clone = res.clone();
        const payload = await clone.json().catch(()=>null);
        const cmd = payload && (payload.result || payload);

        if (cmd && cmd.action && cmd.action !== 'none') return res;

        const local = parseLocal(transcript || '');
        if (local && local.action && local.confidence >= 0.55) {
            return new Response(JSON.stringify({ result: local }), { status:200, headers:{'Content-Type':'application/json'} });
        }
        return res;
        } catch (_) {
        return res;
        }
    };

    console.info('[VoiceDeicticMiddleware] ready for select/scroll/undo/redo/delete/merge/zoom/copy/paste.');
})(window);
