const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const db = require('./db');

const TEMPLATE_PATH = path.join(__dirname, '..', 'template', 'PR-Master-Template.xlsx');
const OUT_DIR = path.join(__dirname, '..', 'generated');

const MAX_ITEMS = 11;
const ITEM_ROW_START = 9;

// Cursive font used to mimic a wet signature on the form
const SIG_FONT = { name: 'Lucida Handwriting', size: 14, italic: true, color: { argb: 'FF1A3D7C' } };

function fmtDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return String(value);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dd = String(d.getDate()).padStart(2,'0');
  return `${dd}-${months[d.getMonth()]}-${d.getFullYear()}`;
}

function setCell(sheet, addr, value) {
  if (value === undefined || value === null) value = '';
  sheet.getCell(addr).value = value;
}

function setSignatureCell(sheet, addr, value) {
  if (value === undefined || value === null) value = '';
  const cell = sheet.getCell(addr);
  cell.value = value;
  cell.font = SIG_FONT;
}

function findActorByStage(approvals, stage, action) {
  for (let i = approvals.length - 1; i >= 0; i--) {
    const a = approvals[i];
    if (a.stage === stage && (!action || a.action === action)) return a;
  }
  return null;
}

async function generatePRWorkbook(prId) {
  const pr = db.getPR(prId);
  if (!pr) throw new Error('PR not found');
  const approvals = db.listApprovals(prId);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(TEMPLATE_PATH);
  const sheet = wb.getWorksheet('PR');
  if (!sheet) throw new Error("Worksheet 'PR' not found in template");

  // Row 6 header
  setCell(sheet, 'A6', `INDENT NO : ${pr.indentNo || '(pending Project Team)'}`);
  setCell(sheet, 'D6', `DEPT : MMCL - ${pr.departmentCode || ''}`);
  setCell(sheet, 'I6', `DATE : ${fmtDate(pr.indentDate)}`);

  // Line items rows 9..19 with the PR-level WBS written into the Budget/Cost Head column
  const items = pr.items || [];
  const wbs = pr.wbs || '';
  for (let i = 0; i < MAX_ITEMS; i++) {
    const row = ITEM_ROW_START + i;
    const it = i < items.length ? items[i] : null;
    setCell(sheet, `B${row}`, it ? it.description : '');
    setCell(sheet, `C${row}`, it ? it.size : '');
    setCell(sheet, `D${row}`, it ? it.specification : '');
    setCell(sheet, `E${row}`, it ? it.uom : '');
    setCell(sheet, `F${row}`, it ? it.qtyRequirement : '');
    setCell(sheet, `G${row}`, it ? (it.qtyStockInHand || '-') : '');
    setCell(sheet, `H${row}`, it ? it.qtyToBuy : '');
    setCell(sheet, `I${row}`, it ? it.areaOfUtilization : '');
    setCell(sheet, `J${row}`, it ? it.rosDate : '');
    setCell(sheet, `K${row}`, it ? (it.estValueUsdPerUnit || '') : '');
    // Budget/Cost Head = WBS, same value on every populated row
    setCell(sheet, `L${row}`, it ? wbs : '');
  }

  // Special instructions row 23
  setCell(sheet, 'A23', pr.specialInstructions || '');

  // Signature block — write to merge masters only
  const indentorActor = { displayName: pr.indentorDisplay, email: pr.indentorEmail };
  const verifierActor = pr.verifierEmail ? { displayName: pr.verifierDisplay, email: pr.verifierEmail } : null;
  const approverActor = pr.approverEmail ? { displayName: pr.approverDisplay, email: pr.approverEmail } : null;

  const verifierApproval = findActorByStage(approvals, 'Verifier', 'Approved');
  const approverApproval = findActorByStage(approvals, 'Approver', 'Approved');
  const submission = findActorByStage(approvals, 'Indentor', 'Submitted');

  // Indentor: name in cursive on B25, date on B26 — but B25:B26 is one merge,
  // so combine into a single value with a line break (ExcelJS preserves \n
  // inside a cell when wrapText is on)
  if (submission) {
    setSignatureCell(sheet, 'B25', `${indentorActor.displayName}\n${fmtDate(submission.actionTimestamp)}`);
    sheet.getCell('B25').alignment = { wrapText: true, vertical: 'middle' };
  } else {
    setSignatureCell(sheet, 'B25', indentorActor.displayName || '');
  }

  if (verifierActor) {
    if (verifierApproval) {
      setSignatureCell(sheet, 'E25', `${verifierActor.displayName}\n${fmtDate(verifierApproval.actionTimestamp)}`);
      sheet.getCell('E25').alignment = { wrapText: true, vertical: 'middle' };
      if (verifierApproval.remarks) {
        const cell = sheet.getCell('G25');
        cell.value = `Remarks: ${verifierApproval.remarks}`;
        cell.font = { name: 'Calibri', size: 10, italic: true, color: { argb: 'FF666666' } };
      }
    } else {
      setCell(sheet, 'E25', verifierActor.displayName);
    }
  }

  // Approver — single name in J25 (overwriting the preprinted "Joe Broking / Rizwan M")
  if (approverActor) {
    if (approverApproval) {
      setSignatureCell(sheet, 'J25', `${approverActor.displayName}   ${fmtDate(approverApproval.actionTimestamp)}`);
      // Keep "Project Head" preprinted label below, append remarks if any
      const titleLine = approverApproval.remarks
        ? `Project Head | Remarks: ${approverApproval.remarks}`
        : 'Project Head';
      setCell(sheet, 'J26', titleLine);
    } else {
      setCell(sheet, 'J25', approverActor.displayName);
    }
  }
  // If not yet signed, leave the original "Joe Broking / Rizwan M" + "Project Head" in J25/J26

  // Purchase closeout
  if (pr.purchase && pr.purchase.indentNo) {
    setCell(sheet, 'B31', pr.purchase.indentNo);
    setCell(sheet, 'B32', fmtDate(pr.purchase.receiptDate));
    setCell(sheet, 'B33', pr.purchase.docRef || '');
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const safeName = (pr.indentNo || `PR-DRAFT-${pr.id}`).replace(/[\\/:\s]/g, '_');
  const outPath = path.join(OUT_DIR, `${safeName}.xlsx`);
  await wb.xlsx.writeFile(outPath);

  db.addApproval({
    prId,
    stage: 'System',
    action: 'ExcelGenerated',
    actorEmail: 'system@local',
    actorDisplay: 'System',
    remarks: `Generated ${path.basename(outPath)}`,
    fromStage: null,
    toStage: null
  });

  return { path: outPath, fileName: path.basename(outPath) };
}

module.exports = { generatePRWorkbook };
