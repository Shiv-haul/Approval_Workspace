// Line-item gallery: add row, remove row, recompute QtyToBuy + line total + grand total live.

(function () {
  const tbody = document.getElementById('itemsBody');
  if (!tbody) return;

  const tpl = document.getElementById('itemRowTemplate');
  const addBtn = document.getElementById('addItemBtn');
  const grandTotalEl = document.getElementById('grandTotal');

  function recompute() {
    let grand = 0;
    let i = 0;
    tbody.querySelectorAll('tr').forEach(tr => {
      i += 1;
      tr.querySelector('.row-index') && (tr.querySelector('.row-index').textContent = i);
      const idxCell = tr.children[0];
      if (idxCell && !tr.querySelector('.row-index')) idxCell.textContent = i;

      const req = Number(tr.querySelector('.qty-req')?.value || 0);
      const stk = Number(tr.querySelector('.qty-stk')?.value || 0);
      const unit = Number(tr.querySelector('.unit-price')?.value || 0);
      const toBuy = Math.max(0, req - stk);
      const lineTotal = +(toBuy * unit).toFixed(2);

      const toBuyCell = tr.querySelector('.qty-tobuy');
      if (toBuyCell) toBuyCell.textContent = toBuy;
      const lineTotalCell = tr.querySelector('.line-total');
      if (lineTotalCell) lineTotalCell.textContent = '$' + lineTotal.toFixed(2);
      grand += lineTotal;
    });
    if (grandTotalEl) grandTotalEl.textContent = '$' + grand.toFixed(2);
  }

  tbody.addEventListener('input', recompute);
  tbody.addEventListener('click', (e) => {
    if (e.target.closest('.remove-item')) {
      e.target.closest('tr').remove();
      recompute();
    }
  });

  addBtn?.addEventListener('click', () => {
    const node = tpl.content.cloneNode(true);
    tbody.appendChild(node);
    recompute();
  });

  // Department: keep hidden departmentName aligned with selected option
  const deptSel = document.getElementById('deptSelect');
  const deptHidden = document.getElementById('deptName');
  if (deptSel && deptHidden) {
    const sync = () => {
      const opt = deptSel.options[deptSel.selectedIndex];
      deptHidden.value = opt?.dataset.name || '';
    };
    deptSel.addEventListener('change', sync);
    sync();
  }

  recompute();
})();
