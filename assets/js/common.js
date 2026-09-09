(() => {
  document.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('pointerdown', () => btn.classList.add('is-pressed'));
    ['pointerup','pointerleave','pointercancel'].forEach(ev => btn.addEventListener(ev, () => btn.classList.remove('is-pressed')));
  });
})();
