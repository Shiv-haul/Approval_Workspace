const db = require('./db');

function fiscalYearTag(date = new Date()) {
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  if (m >= 4) return `FY${String(y).slice(-2)}${String(y + 1).slice(-2)}`;
  return `FY${String(y - 1).slice(-2)}${String(y).slice(-2)}`;
}

// Real PR format observed: "MMCL PR-467" — simple global sequential.
function generateIndentNo() {
  const seq = db.bumpCounter('PR_GLOBAL');
  return {
    indentNo: `MMCL PR-${String(seq).padStart(3, '0')}`,
    fiscalYear: fiscalYearTag(),
    sequence: seq
  };
}

module.exports = { fiscalYearTag, generateIndentNo };
