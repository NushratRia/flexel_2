// static/js/gestureModeGate.js
// Gate all gesture work to only 'gesture' & 'combination' modes.
// Zero changes to other files.

(function () {
  const ALLOWED = new Set(['gesture', 'combination']);
  let enabled = false;

  const modeSel = () => document.getElementById('modeSelector');
  const modeNow = () => (modeSel() ? modeSel().value : 'wimp');
  const allowedNow = () => ALLOWED.has(modeNow());

  function announce(on) {
    document.dispatchEvent(new CustomEvent('gestures:toggled', { detail: { enabled: on } }));
    document.documentElement.classList.toggle('gesture-active', on);
    document.documentElement.classList.toggle('gesture-inactive', !on);
    console.log('[GestureGate]', on ? 'ENABLED' : 'DISABLED', 'for mode:', modeNow());
  }

  function setEnabled(next) {
    if (enabled === next) return;
    enabled = next;
    announce(enabled);
  }

  // Patch Mediapipe Hands so frames are ignored when disabled
  function patchHands() {
    const h = window.hands;
    if (!h || h.__gestureGatePatched) return !!h;
    const origSend = h.send.bind(h);
    h.send = (...args) => (enabled ? origSend(...args) : Promise.resolve());
    h.__gestureGatePatched = true;
    console.log('[GestureGate] Patched hands.send()');
    return true;
  }

  // Patch your gesture action entrypoint (if present)
  function patchGestureActions() {
    const GA = window.GestureActions;
    if (!GA || GA.__gestureGatePatched) return !!GA;

    if (typeof GA.execute === 'function') {
      const orig = GA.execute.bind(GA);
      GA.execute = (...args) => (enabled ? orig(...args) : false);
      console.log('[GestureGate] Wrapped GestureActions.execute()');
    }
    GA.__gestureGatePatched = true;
    return true;
  }

  function hookMode() {
    const sel = modeSel();
    if (!sel) return false;
    sel.addEventListener('change', () => setEnabled(allowedNow()));
    setEnabled(allowedNow());
    return true;
  }

  function init() {
    const okH = patchHands();
    const okA = patchGestureActions();
    const okM = hookMode();

    // Apply current state once even if not all globals are ready yet
    setEnabled(allowedNow());

    // Retry briefly while late-loading scripts appear
    if (!okH || !okA || !okM) {
      let tries = 30;
      const id = setInterval(() => {
        const ready = patchHands() & patchGestureActions() & hookMode();
        setEnabled(allowedNow());
        if (ready || --tries <= 0) clearInterval(id);
      }, 150);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
