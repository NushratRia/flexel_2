/* static/js/tipsVideoHover.js */
(() => {
    async function capturePosterFromVideo(url) {
        return new Promise((resolve, reject) => {
        const video = document.createElement('video');
        video.src = url;
        video.crossOrigin = "anonymous";
        video.muted = true;
        video.playsInline = true;
        video.preload = "auto";

        video.addEventListener("loadeddata", () => {
            try {
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL("image/png"));
            } catch (err) {
            reject(err);
            }
        });

        video.addEventListener("error", reject);
        });
    }

    async function upgradeImageToVideo(img) {
        const mov = img.getAttribute('data-mov');
        if (!mov) return;

        const vid = document.createElement('video');
        vid.className = 'tip-video';
        vid.muted = true;
        vid.loop = true;
        vid.playsInline = true;
        vid.preload = 'metadata';

        // Automatically extract first frame as poster
        try {
        const poster = await capturePosterFromVideo(mov);
        vid.setAttribute('poster', poster);
        } catch (_) {
        console.warn("Could not capture poster for", mov);
        }

        const src = document.createElement('source');
        src.src = mov;
        src.type = 'video/mp4';
        vid.appendChild(src);

        vid.style.width = '100%';
        vid.style.display = 'block';

        img.replaceWith(vid);

        const container = vid.closest('.tip-gif') || vid;
        const play = () => vid.play().catch(() => {});
        const stop = () => { vid.pause(); vid.currentTime = 0; };

        container.addEventListener('mouseenter', play);
        container.addEventListener('mouseleave', stop);
        container.addEventListener('focusin', play);
        container.addEventListener('focusout', stop);
    }

    function scan(root = document) {
        root.querySelectorAll('img.gif-hover[data-mov]').forEach(upgradeImageToVideo);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => scan(document));
    } else {
        scan(document);
    }
})();


















// /* static/js/tipsVideoHover.js */
// (() => {
//     function upgradeImageToVideo(img) {
//         const mov = img.getAttribute('data-mov');
//         if (!mov) return;

//         const vid = document.createElement('video');
//         vid.className = 'tip-video';
//         vid.muted = true;
//         vid.loop = true;
//         vid.playsInline = true;
//         vid.preload = 'metadata';

//         const poster = img.getAttribute('data-still');
//         if (poster) vid.setAttribute('poster', poster);

//         const src = document.createElement('source');
//         src.src = mov;
//         src.type = 'video/mp4';
//         vid.appendChild(src);

//         // Keep layout consistent with existing images
//         vid.style.width = '100%';
//         vid.style.display = 'block';

//         // Replace the IMG in-place (structure preserved)
//         img.replaceWith(vid);

//         const container = vid.closest('.tip-gif') || vid;

//         const play = () => vid.play().catch(() => {});
//         const stop = () => { vid.pause(); vid.currentTime = 0; };

//         // Desktop hover/focus
//         container.addEventListener('mouseenter', play);
//         container.addEventListener('mouseleave', stop);
//         container.addEventListener('focusin', play);
//         container.addEventListener('focusout', stop);

//         // Touch: tap to toggle
//         let tapped = false;
//         container.addEventListener('touchstart', () => {
//         tapped = !tapped;
//         if (tapped) vid.play().catch(() => {});
//         else stop();
//         }, { passive: true });

//         // If tips panel closes, pause videos
//         const tipsPanel = document.getElementById('tipsPanel');
//         if (tipsPanel) {
//         new MutationObserver(() => {
//             if (!tipsPanel.classList.contains('open')) stop();
//         }).observe(tipsPanel, { attributes: true, attributeFilter: ['class'] });
//         }

//         // Fallback if video fails to load
//         vid.addEventListener('error', () => {
//         try { vid.replaceWith(img); } catch (_) {}
//         });
//     }

//     function scan(root = document) {
//         root.querySelectorAll('img.gif-hover[data-mov]').forEach(upgradeImageToVideo);
//     }

//     // Minimal style so videos follow the same rules as images
//     const style = document.createElement('style');
//     style.textContent = `
//         #tipsPanel .tip-gif video { width:100%; display:block; }
//     `;
//     document.head.appendChild(style);

//     if (document.readyState === 'loading') {
//         document.addEventListener('DOMContentLoaded', () => scan(document));
//     } else {
//         scan(document);
//     }

//     // Upgrade any items added later
//     const mo = new MutationObserver(mutations => {
//         for (const m of mutations) {
//         for (const node of m.addedNodes) {
//             if (node.nodeType !== 1) continue;
//             if (node.matches?.('img.gif-hover[data-mov]')) upgradeImageToVideo(node);
//             node.querySelectorAll?.('img.gif-hover[data-mov]').forEach(upgradeImageToVideo);
//         }
//         }
//     });
//     mo.observe(document.documentElement, { childList: true, subtree: true });
// })();
