/* static/js/deicticHud.js */
(function (global){
    const DT = global.DeicticTarget;
    if (!DT) return;
    const tag = document.createElement('div');
    Object.assign(tag.style, {
        position:'fixed', bottom:'20px', left:'20px', padding:'6px 10px',
        background:'rgba(0,0,0,.6)', color:'#fff', borderRadius:'8px',
        font:'12px system-ui, -apple-system, Segoe UI, Roboto, sans-serif', zIndex:100001
    });
    tag.textContent = 'target: –';
    document.body.appendChild(tag);

    setInterval(()=>{
        let txt = '–';
        const a1 = DT.getCellA1 && DT.getCellA1();
        const col = DT.getColLetter && DT.getColLetter();
        const row = DT.getRowIndex && DT.getRowIndex();
        if (a1) txt = a1;
        else if (col) txt = `col ${col}`;
        else if (row) txt = `row ${row}`;
        tag.textContent = `target: ${txt}`;
    }, 150);
})(window);
