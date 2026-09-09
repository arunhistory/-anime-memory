(() => {
  const dir = document.getElementById('all-sort-direction');
  if (dir) dir.addEventListener('click', () => {
    const asc = dir.dataset.dir !== 'desc';
    dir.dataset.dir = asc ? 'desc' : 'asc';
    dir.textContent = asc ? '↓ 降順' : '↑ 昇順';
  });

  // all.wasm 接続時、CSVバイト列の受け渡しと段階描画のみを担当する。
  // 全件読込・ソートはall.wasm側で処理する。
})();
