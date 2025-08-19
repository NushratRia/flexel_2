/* static/js/deicticTarget.js */
(function (global) {
    'use strict';
    const GU = global.GestureUtils || {};
    function colLetters(i){ let n=i,s=''; do{s=String.fromCharCode(65+(n%26))+s;n=Math.floor(n/26)-1;}while(n>=0); return s; }
    function getHot(){ return (global.GestureActions && global.GestureActions._hot) || global.hot || null; }

    const Target = {
        _last:null,
        _freshMs:1800, // survives hotword + STT lag

        _updateFromFinger(res){
        if(!res||!res.multiHandLandmarks||!res.multiHandLandmarks.length) return;
        const lm = res.multiHandLandmarks[0];
        const el = (GU.elementAt && GU.elementAt(lm[8])) || null;

        if (el && el.closest){
            if (el.closest('.ht_clone_top')){
            const hdr = el.closest('th,div') || el;
            const idx = (hdr.cellIndex!=null) ? hdr.cellIndex
                        : Array.from(hdr.parentNode.children).indexOf(hdr);
            if(idx>=0){ this._last = {type:'col', colLetter: colLetters(idx), t: performance.now()}; return; }
            }
            if (el.closest('.ht_clone_left')){
            const hdr = el.closest('th,div') || el;
            const num = parseInt((hdr.textContent||hdr.innerText||'').trim(),10);
            if(!Number.isNaN(num)){ this._last = {type:'row', row1:num, t:performance.now()}; return; }
            }
        }

        const td = GU.tdAt ? GU.tdAt(lm[8]) : null;
        if(td){
            const hot = getHot();
            const rc = (hot && typeof hot.getCoords==='function') ? hot.getCoords(td) : (GU.rcFromTD && GU.rcFromTD(td));
            if(rc && rc.col>=0 && rc.row>=0){
            this._last = {type:'cell', a1:`${colLetters(rc.col)}${rc.row+1}`, t: performance.now()};
            }
        }
        },

        _fallbackFromSelection(){
        const hot = getHot();
        const sel = hot && hot.getSelectedLast && hot.getSelectedLast();
        if(!sel) return null;
        const r1 = Math.min(sel[0], sel[2]), c1 = Math.min(sel[1], sel[3]);
        const r2 = Math.max(sel[0], sel[2]), c2 = Math.max(sel[1], sel[3]);
        if(r1===r2 && c1===c2) return {type:'cell', a1:`${colLetters(c1)}${r1+1}`};
        const rows = hot && hot.countRows ? hot.countRows() : null;
        const cols = hot && hot.countCols ? hot.countCols() : null;
        if(rows && r1===0 && r2>=rows-1 && c1===c2) return {type:'col', colLetter: colLetters(c1)};
        if(cols && c1===0 && c2>=cols-1 && r1===r2) return {type:'row', row1: r1+1};
        return {type:'cell', a1:`${colLetters(c1)}${r1+1}`};
        },

        get(){
        const fresh = this._last && (performance.now()-this._last.t)<this._freshMs;
        return fresh ? this._last : this._fallbackFromSelection();
        },
        getCellA1(){ const g=this.get(); if(!g) return null; if(g.type==='cell') return g.a1; if(g.type==='col') return `${g.colLetter}1`; if(g.type==='row') return `A${g.row1}`; return null; },
        getColLetter(){ const g=this.get(); if(!g) return null; if(g.type==='col') return g.colLetter; if(g.type==='cell') return g.a1.replace(/\d+$/,''); return null; },
        getRowIndex(){ const g=this.get(); if(!g) return null; if(g.type==='row') return g.row1; if(g.type==='cell'){ const m=g.a1.match(/\d+$/); return m?parseInt(m[0],10):null; } return null; }
    };

    function attachWhenReady(){
        function tryAttach(){
        const hands = (global.GestureActions && global.GestureActions._hands) || global.hands || null;
        if(!hands) return false;
        if(GU && typeof GU.multiplexOnResults==='function') GU.multiplexOnResults(hands);
        hands.onResults((res)=>Target._updateFromFinger(res));
        console.info('[DeicticTarget] attached.');
        return true;
        }
        if(!tryAttach()){
        const id=setInterval(()=>{ if(tryAttach()) clearInterval(id); },250);
        setTimeout(()=>clearInterval(id),15000);
        }
    }
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', attachWhenReady);
    else attachWhenReady();

    global.DeicticTarget = Target;
})(window);
