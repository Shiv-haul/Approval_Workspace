const db = require('./db');
const { generateIndentNo } = require('./indent');

const STATUS = Object.freeze({
  DRAFT: 'Draft',
  WITH_PROJECT_TEAM: 'WithProjectTeam',
  AWAITING_INDENTOR_FORWARD: 'AwaitingIndentorForward',
  WITH_VERIFIER: 'WithVerifier',
  WITH_APPROVER: 'WithApprover',
  RETURNED: 'ReturnedForEdit',
  APPROVED: 'Approved',
  CLOSED: 'ClosedByPurchase',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled'
});

const STAGE = Object.freeze({
  INDENTOR: 'Indentor',
  PROJECT_TEAM: 'ProjectTeam',
  VERIFIER: 'Verifier',
  APPROVER: 'Approver',
  PURCHASE: 'Purchase',
  DONE: 'Done',
  SYSTEM: 'System'
});

function recomputeRollups(pr) {
  const items = pr.items || [];
  let total = 0;
  for (const it of items) {
    const req = Number(it.qtyRequirement || 0);
    const stk = Number(it.qtyStockInHand || 0);
    const unit = Number(it.estValueUsdPerUnit || 0);
    it.qtyToBuy = Math.max(0, req - stk);
    it.lineTotalUSD = +(it.qtyToBuy * unit).toFixed(2);
    total += it.lineTotalUSD;
  }
  pr.totalEstValueUSD = +total.toFixed(2);
  pr.itemCount = items.length;
  return pr;
}

function audit(prId, stage, action, actor, remarks, fromStage, toStage) {
  return db.addApproval({
    prId,
    stage,
    action,
    actorEmail: actor.email,
    actorDisplay: actor.displayName,
    remarks: remarks || '',
    fromStage: fromStage || null,
    toStage: toStage || null
  });
}

// Indentor submits a Draft → goes to Project Team for number/WBS assignment.
// Or resubmits a Returned PR → resumes from fromStage.
function submit(prId, actor, remarks) {
  const pr = db.getPR(prId);
  if (!pr) throw new Error('PR not found');
  if (pr.status !== STATUS.DRAFT && pr.status !== STATUS.RETURNED) {
    throw new Error(`Cannot submit a PR in status ${pr.status}`);
  }
  if (pr.indentorEmail !== actor.email) {
    throw new Error('Only the indentor can submit this PR');
  }
  if (!pr.items || pr.items.length === 0) {
    throw new Error('Add at least one line item before submitting');
  }
  if (!pr.verifierEmail) throw new Error('Verifier is required');
  // Approver is a pool (Joe / Rizwan) — not picked by indentor

  recomputeRollups(pr);

  const updates = { ...pr };

  if (pr.status === STATUS.DRAFT) {
    // First submission — go to Project Team. No PR number yet.
    updates.status = STATUS.WITH_PROJECT_TEAM;
    updates.currentStage = STAGE.PROJECT_TEAM;
    updates.fromStage = null;
    audit(prId, STAGE.INDENTOR, 'Submitted', actor, remarks, STAGE.INDENTOR, STAGE.PROJECT_TEAM);
  } else {
    // Resubmit after edit — resume from the stage that returned it.
    const resumeStage = pr.fromStage || STAGE.PROJECT_TEAM;
    let resumeStatus;
    switch (resumeStage) {
      case STAGE.PROJECT_TEAM: resumeStatus = STATUS.WITH_PROJECT_TEAM; break;
      case STAGE.VERIFIER:     resumeStatus = STATUS.WITH_VERIFIER;     break;
      case STAGE.APPROVER:     resumeStatus = STATUS.WITH_APPROVER;     break;
      default:                 resumeStatus = STATUS.WITH_PROJECT_TEAM;
    }
    updates.status = resumeStatus;
    updates.currentStage = resumeStage;
    updates.fromStage = null;
    audit(prId, STAGE.INDENTOR, 'Edited', actor, remarks, STAGE.INDENTOR, resumeStage);
  }

  return db.updatePR(prId, updates);
}

// Project Team member assigns the PR number + WBS (or returns / rejects).
function projectTeamAction(prId, actor, decision, payload) {
  const pr = db.getPR(prId);
  if (!pr) throw new Error('PR not found');
  if (pr.status !== STATUS.WITH_PROJECT_TEAM) throw new Error('PR is not awaiting Project Team action');
  if (!actor.roles || !actor.roles.includes('ProjectTeam')) {
    throw new Error('Only Project Team members can act on this PR');
  }

  if (decision === 'assign') {
    if (!payload || !payload.wbs) throw new Error('WBS is required');

    // Either auto-generate the indent number or use the manual override
    let indentNo = pr.indentNo;
    let fiscalYear = pr.fiscalYear;
    if (payload.indentNoMode === 'auto' || !payload.indentNoOverride) {
      if (!indentNo) {
        const gen = generateIndentNo();
        indentNo = gen.indentNo;
        fiscalYear = gen.fiscalYear;
        audit(prId, STAGE.SYSTEM, 'NumberAssigned', { email: 'system@local', displayName: 'System' },
              `Auto-generated ${indentNo}`, null, null);
      }
    } else {
      indentNo = payload.indentNoOverride.trim();
      audit(prId, STAGE.PROJECT_TEAM, 'NumberAssigned', actor,
            `Manually assigned ${indentNo}`, null, null);
    }

    audit(prId, STAGE.PROJECT_TEAM, 'AssignedNumberAndWBS', actor,
          `Assigned WBS ${payload.wbs}` + (payload.remarks ? ` · ${payload.remarks}` : ''),
          STAGE.PROJECT_TEAM, STAGE.INDENTOR);

    return db.updatePR(prId, {
      indentNo,
      fiscalYear,
      wbs: payload.wbs,
      projectTeamMemberEmail: actor.email,
      projectTeamMemberDisplay: actor.displayName,
      status: STATUS.AWAITING_INDENTOR_FORWARD,
      currentStage: STAGE.INDENTOR
    });
  }

  if (decision === 'return') {
    if (!payload || !payload.remarks) throw new Error('Remarks are required when returning for edit');
    audit(prId, STAGE.PROJECT_TEAM, 'Returned', actor, payload.remarks, STAGE.PROJECT_TEAM, STAGE.INDENTOR);
    return db.updatePR(prId, { status: STATUS.RETURNED, currentStage: STAGE.INDENTOR, fromStage: STAGE.PROJECT_TEAM });
  }

  if (decision === 'reject') {
    if (!payload || !payload.remarks) throw new Error('Remarks are required when rejecting');
    audit(prId, STAGE.PROJECT_TEAM, 'Rejected', actor, payload.remarks, STAGE.PROJECT_TEAM, STAGE.DONE);
    return db.updatePR(prId, { status: STATUS.REJECTED, currentStage: STAGE.DONE });
  }

  throw new Error(`Unknown decision: ${decision}`);
}

// After PT assigns number+WBS, indentor reviews and forwards to Verifier.
function indentorForward(prId, actor, remarks) {
  const pr = db.getPR(prId);
  if (!pr) throw new Error('PR not found');
  if (pr.status !== STATUS.AWAITING_INDENTOR_FORWARD) throw new Error('PR is not awaiting indentor forward');
  if (pr.indentorEmail !== actor.email) throw new Error('Only the indentor can forward');
  audit(prId, STAGE.INDENTOR, 'Forwarded', actor, remarks, STAGE.INDENTOR, STAGE.VERIFIER);
  return db.updatePR(prId, { status: STATUS.WITH_VERIFIER, currentStage: STAGE.VERIFIER });
}

function verifierAction(prId, actor, decision, remarks) {
  const pr = db.getPR(prId);
  if (!pr) throw new Error('PR not found');
  if (pr.status !== STATUS.WITH_VERIFIER) throw new Error('PR is not awaiting verification');
  if (pr.verifierEmail !== actor.email) throw new Error('You are not the verifier on this PR');

  if (decision === 'approve') {
    audit(prId, STAGE.VERIFIER, 'Approved', actor, remarks, STAGE.VERIFIER, STAGE.APPROVER);
    return db.updatePR(prId, { status: STATUS.WITH_APPROVER, currentStage: STAGE.APPROVER });
  }
  if (decision === 'return') {
    if (!remarks) throw new Error('Remarks are required when returning for edit');
    audit(prId, STAGE.VERIFIER, 'Returned', actor, remarks, STAGE.VERIFIER, STAGE.INDENTOR);
    return db.updatePR(prId, { status: STATUS.RETURNED, currentStage: STAGE.INDENTOR, fromStage: STAGE.VERIFIER });
  }
  if (decision === 'reject') {
    if (!remarks) throw new Error('Remarks are required when rejecting');
    audit(prId, STAGE.VERIFIER, 'Rejected', actor, remarks, STAGE.VERIFIER, STAGE.DONE);
    return db.updatePR(prId, { status: STATUS.REJECTED, currentStage: STAGE.DONE });
  }
  throw new Error(`Unknown decision: ${decision}`);
}

function approverAction(prId, actor, decision, remarks) {
  const pr = db.getPR(prId);
  if (!pr) throw new Error('PR not found');
  if (pr.status !== STATUS.WITH_APPROVER) throw new Error('PR is not awaiting approval');
  if (!actor.roles || !actor.roles.includes('Approver')) {
    throw new Error('Only an approver from the pool may act on this PR');
  }

  // First approver to act becomes the approver of record
  const approverPatch = {
    approverEmail: actor.email,
    approverDisplay: actor.displayName
  };

  if (decision === 'approve') {
    audit(prId, STAGE.APPROVER, 'Approved', actor, remarks, STAGE.APPROVER, STAGE.PURCHASE);
    return db.updatePR(prId, { ...approverPatch, status: STATUS.APPROVED, currentStage: STAGE.PURCHASE });
  }
  if (decision === 'return') {
    if (!remarks) throw new Error('Remarks are required when returning for edit');
    audit(prId, STAGE.APPROVER, 'Returned', actor, remarks, STAGE.APPROVER, STAGE.INDENTOR);
    return db.updatePR(prId, { ...approverPatch, status: STATUS.RETURNED, currentStage: STAGE.INDENTOR, fromStage: STAGE.APPROVER });
  }
  if (decision === 'reject') {
    if (!remarks) throw new Error('Remarks are required when rejecting');
    audit(prId, STAGE.APPROVER, 'Rejected', actor, remarks, STAGE.APPROVER, STAGE.DONE);
    return db.updatePR(prId, { ...approverPatch, status: STATUS.REJECTED, currentStage: STAGE.DONE });
  }
  throw new Error(`Unknown decision: ${decision}`);
}

function closeoutByPurchase(prId, actor, closeout) {
  const pr = db.getPR(prId);
  if (!pr) throw new Error('PR not found');
  if (pr.status !== STATUS.APPROVED) throw new Error('PR is not awaiting purchase closeout');
  if (!actor.roles || !actor.roles.includes('Purchase')) throw new Error('Only the Purchase team can close this PR');
  if (!closeout.indentNo) throw new Error('Purchase Indent No is required');

  audit(prId, STAGE.PURCHASE, 'Closed', actor,
    `Purchase Indent: ${closeout.indentNo}, Doc Ref: ${closeout.docRef || ''}`,
    STAGE.PURCHASE, STAGE.DONE);
  return db.updatePR(prId, {
    status: STATUS.CLOSED,
    currentStage: STAGE.DONE,
    purchase: {
      indentNo: closeout.indentNo,
      receiptDate: closeout.receiptDate || null,
      docRef: closeout.docRef || null
    }
  });
}

function cancel(prId, actor, remarks) {
  const pr = db.getPR(prId);
  if (!pr) throw new Error('PR not found');
  if (pr.indentorEmail !== actor.email) throw new Error('Only the indentor can cancel');
  if (![STATUS.DRAFT, STATUS.RETURNED, STATUS.AWAITING_INDENTOR_FORWARD].includes(pr.status)) {
    throw new Error('Cancel is only allowed in Draft, ReturnedForEdit, or AwaitingIndentorForward');
  }
  audit(prId, STAGE.INDENTOR, 'Cancelled', actor, remarks, pr.currentStage, STAGE.DONE);
  return db.updatePR(prId, { status: STATUS.CANCELLED, currentStage: STAGE.DONE });
}

module.exports = {
  STATUS, STAGE,
  recomputeRollups,
  submit,
  projectTeamAction,
  indentorForward,
  verifierAction,
  approverAction,
  closeoutByPurchase,
  cancel,
  audit
};
