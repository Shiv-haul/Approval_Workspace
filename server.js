const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');

const db = require('./lib/db');
const wf = require('./lib/workflow');
const { generatePRWorkbook } = require('./lib/excelgen');
const { seed } = require('./lib/seed');

const app = express();
const PORT = process.env.PORT || 3000;

if (!fs.existsSync(path.join(__dirname, 'db.json'))) {
  seed({ reset: true });
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'mmcl-pr-local-prototype',
  resave: false,
  saveUninitialized: true,
  cookie: { httpOnly: true }
}));

// ---- Auth middleware ----
app.use((req, res, next) => {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;

  const openPaths = ['/login', '/styles.css', '/app.js'];
  if (openPaths.includes(req.path) || req.path.startsWith('/_debug')) return next();

  if (!req.session.userEmail) {
    if (req.method === 'GET') return res.redirect('/login');
    return res.status(401).send('Not signed in');
  }

  const user = db.getUserByEmail(req.session.userEmail);
  if (!user) {
    req.session.userEmail = null;
    return res.redirect('/login');
  }
  res.locals.currentUser = user;
  res.locals.allDepartments = db.listDepartments();
  res.locals.allUsers = db.listUsers();
  next();
});

function flash(req, type, msg) { req.session.flash = { type, msg }; }

function awaitingForUser(pr, me) {
  const roles = me.roles || [];
  if (pr.status === 'WithProjectTeam' && roles.includes('ProjectTeam')) return true;
  if (pr.status === 'AwaitingIndentorForward' && pr.indentorEmail === me.email) return true;
  if (pr.status === 'WithVerifier' && pr.verifierEmail === me.email) return true;
  if (pr.status === 'WithApprover' && roles.includes('Approver')) return true;
  if (pr.status === 'Approved' && roles.includes('Purchase')) return true;
  return false;
}

// ---- Login / Logout ----
app.get('/login', (req, res) => {
  if (req.session.userEmail) return res.redirect('/');
  res.render('login', { error: null, email: '' });
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  const u = db.getUserByEmail((email || '').trim().toLowerCase());
  if (!u || u.password !== password) {
    return res.render('login', { error: 'Invalid email or password.', email: email || '' });
  }
  req.session.userEmail = u.email;
  flash(req, 'success', `Welcome, ${u.displayName.split(' ')[0]}.`);
  res.redirect('/');
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

// ---- MMCL landing ----
app.get('/', (req, res) => {
  const me = res.locals.currentUser;
  const all = db.listPRs();
  const counts = {
    awaiting: all.filter(p => awaitingForUser(p, me)).length,
    drafts: all.filter(p => p.status === 'Draft' && p.indentorEmail === me.email).length
  };
  res.render('landing', { page: 'landing', counts });
});

app.get('/nfa', (req, res) => res.render('nfa-coming-soon', { page: 'nfa' }));

// ---- PR home / dashboard ----
app.get('/pr', (req, res) => {
  const me = res.locals.currentUser;
  const all = db.listPRs();

  const drafts = all.filter(p => p.status === 'Draft' && p.indentorEmail === me.email);
  const returned = all.filter(p => p.status === 'ReturnedForEdit' && p.indentorEmail === me.email);
  const awaitingForward = all.filter(p => p.status === 'AwaitingIndentorForward' && p.indentorEmail === me.email);
  const submittedByMe = all.filter(p => p.indentorEmail === me.email);
  const awaitingMe = all.filter(p => awaitingForUser(p, me));

  res.render('home', {
    page: 'home',
    drafts, returned, awaitingForward, submittedByMe, awaitingMe, allCount: all.length
  });
});

app.get('/pr/list', (req, res) => {
  const filter = req.query.filter || 'all';
  const me = res.locals.currentUser;
  let prs = db.listPRs();
  if (filter === 'mine') prs = prs.filter(p => p.indentorEmail === me.email);
  if (filter === 'awaiting') prs = prs.filter(p => awaitingForUser(p, me));
  res.render('pr-list', { page: 'list', prs, filter });
});

app.get('/pr/new', (req, res) => {
  const me = res.locals.currentUser;
  if (!(me.roles || []).includes('Indentor')) {
    flash(req, 'error', 'Only an Indentor can create PRs.');
    return res.redirect('/pr');
  }
  const state = db.rawState();
  const cfg = state.config || {};
  const myDept = state.departments.find(d => d.code === me.departmentCode) || { code: 'IT', name: 'Information Technology' };
  const verifierEmail = (cfg.verifierForDept || {})[myDept.code] || 'niranjan.shinde@mesabimetallics.com';
  const verifierUser = db.getUserByEmail(verifierEmail);

  const draft = {
    id: null,
    departmentCode: myDept.code,
    departmentName: myDept.name,
    indentDate: new Date().toISOString().slice(0,10),
    indentorEmail: me.email,
    indentorDisplay: me.displayName,
    verifierEmail: verifierUser ? verifierUser.email : verifierEmail,
    verifierDisplay: verifierUser ? verifierUser.displayName : 'Niranjan Shinde',
    specialInstructions: '',
    items: []
  };
  res.render('pr-edit', { page: 'edit', pr: draft, isNew: true });
});

app.get('/pr/:id/edit', (req, res) => {
  const pr = db.getPR(req.params.id);
  if (!pr) return res.status(404).send('PR not found');
  const me = res.locals.currentUser;
  if (pr.indentorEmail !== me.email) return res.status(403).send('Only the indentor can edit this PR');
  if (!['Draft','ReturnedForEdit'].includes(pr.status)) {
    return res.status(400).send(`Cannot edit a PR in status ${pr.status}`);
  }
  res.render('pr-edit', { page: 'edit', pr, isNew: false });
});

app.post('/pr/save', (req, res) => {
  const me = res.locals.currentUser;
  if (!(me.roles || []).includes('Indentor')) return res.status(403).send('Only Indentors can save PRs');

  const body = req.body;
  const items = parseItems(body);

  const payload = {
    departmentCode: body.departmentCode,
    departmentName: body.departmentName,
    indentDate: body.indentDate,
    indentorEmail: me.email,
    indentorDisplay: me.displayName,
    verifierEmail: body.verifierEmail || 'niranjan.shinde@mesabimetallics.com',
    verifierDisplay: lookupDisplay(body.verifierEmail) || 'Niranjan Shinde',
    specialInstructions: body.specialInstructions || '',
    items
  };

  let pr;
  if (body.id) {
    pr = db.getPR(body.id);
    if (!pr) return res.status(404).send('PR not found');
    if (pr.indentorEmail !== me.email) return res.status(403).send('Only the indentor can edit');
    Object.assign(pr, payload);
    wf.recomputeRollups(pr);
    pr = db.updatePR(pr.id, pr);
  } else {
    pr = wf.recomputeRollups({
      indentNo: null,
      wbs: null,
      status: 'Draft',
      currentStage: 'Indentor',
      fromStage: null,
      fiscalYear: null,
      approverEmail: null,
      approverDisplay: null,
      purchase: { indentNo: null, receiptDate: null, docRef: null },
      ...payload
    });
    pr = db.createPR(pr);
    wf.audit(pr.id, 'Indentor', 'Created', { email: me.email, displayName: me.displayName }, '', null, 'Indentor');
  }

  if (body.action === 'submit') {
    try {
      pr = wf.submit(pr.id, { email: me.email, displayName: me.displayName }, body.submitRemarks || '');
      flash(req, 'success',
        pr.status === 'WithProjectTeam'
          ? 'Submitted. Awaiting Project Team to assign PR number + Budget/Cost Head (WBS).'
          : `Resumed at ${pr.currentStage}.`);
      return res.redirect(`/pr/${pr.id}`);
    } catch (err) {
      flash(req, 'error', err.message);
      return res.redirect(`/pr/${pr.id}/edit`);
    }
  }

  flash(req, 'success', 'Draft saved.');
  res.redirect(`/pr/${pr.id}/edit`);
});

function parseItems(body) {
  const out = [];
  if (!body.itemDescription) return out;
  const arr = (k) => Array.isArray(body[k]) ? body[k] : [body[k]];
  const desc = arr('itemDescription');
  for (let i = 0; i < desc.length; i++) {
    if (!desc[i] || !String(desc[i]).trim()) continue;
    const qReq = Number(arr('qtyRequirement')[i] || 0);
    const qStk = Number(arr('qtyStockInHand')[i] || 0);
    const unit = Number(arr('estValueUsdPerUnit')[i] || 0);
    const qToBuy = Math.max(0, qReq - qStk);
    out.push({
      lineNo: out.length + 1,
      description: desc[i],
      size: arr('itemSize')[i] || '',
      specification: arr('specification')[i] || '',
      uom: arr('uom')[i] || '',
      qtyRequirement: qReq,
      qtyStockInHand: qStk,
      qtyToBuy: qToBuy,
      areaOfUtilization: arr('areaOfUtilization')[i] || '',
      rosDate: arr('rosDate')[i] || '',
      estValueUsdPerUnit: unit,
      lineTotalUSD: +(qToBuy * unit).toFixed(2)
    });
  }
  return out;
}

function lookupDisplay(email) {
  if (!email) return '';
  const u = db.getUserByEmail(email);
  return u ? u.displayName : email;
}

// ---- Detail ----
app.get('/pr/:id', (req, res) => {
  const pr = db.getPR(req.params.id);
  if (!pr) return res.status(404).send('PR not found');
  const approvals = db.listApprovals(pr.id);
  const me = res.locals.currentUser;
  const roles = me.roles || [];

  const canProjectTeamAct = pr.status === 'WithProjectTeam' && roles.includes('ProjectTeam');
  const canIndentorForward = pr.status === 'AwaitingIndentorForward' && pr.indentorEmail === me.email;
  const canVerify = pr.status === 'WithVerifier' && pr.verifierEmail === me.email;
  const canApprove = pr.status === 'WithApprover' && roles.includes('Approver');
  const canCloseout = pr.status === 'Approved' && roles.includes('Purchase');
  const canEdit = ['Draft','ReturnedForEdit'].includes(pr.status) && pr.indentorEmail === me.email;
  const canCancel = ['Draft','ReturnedForEdit','AwaitingIndentorForward'].includes(pr.status) && pr.indentorEmail === me.email;

  res.render('pr-detail', {
    page: 'detail',
    pr, approvals,
    canProjectTeamAct, canIndentorForward,
    canVerify, canApprove, canCloseout, canEdit, canCancel
  });
});

app.post('/pr/:id/project-team-action', (req, res) => {
  try {
    const me = res.locals.currentUser;
    const decision = req.body.decision;
    const payload = {
      wbs: req.body.wbs,
      indentNoMode: req.body.indentNoMode || 'auto',
      indentNoOverride: req.body.indentNoOverride || '',
      remarks: req.body.remarks || ''
    };
    const pr = wf.projectTeamAction(
      Number(req.params.id),
      { email: me.email, displayName: me.displayName, roles: me.roles || [] },
      decision,
      payload
    );
    flash(req, 'success',
      decision === 'assign' ? `Assigned ${pr.indentNo} · Budget/Cost Head ${pr.wbs}.` :
      decision === 'return' ? 'Returned to indentor for edits.' :
      'Rejected.');
  } catch (err) {
    flash(req, 'error', err.message);
  }
  res.redirect(`/pr/${req.params.id}`);
});

app.post('/pr/:id/forward', (req, res) => {
  try {
    const me = res.locals.currentUser;
    const pr = wf.indentorForward(
      Number(req.params.id),
      { email: me.email, displayName: me.displayName },
      req.body.remarks || ''
    );
    flash(req, 'success', `Forwarded to ${pr.verifierDisplay} for verification.`);
  } catch (err) {
    flash(req, 'error', err.message);
  }
  res.redirect(`/pr/${req.params.id}`);
});

app.post('/pr/:id/verifier-action', (req, res) => {
  try {
    const me = res.locals.currentUser;
    const pr = wf.verifierAction(
      Number(req.params.id),
      { email: me.email, displayName: me.displayName },
      req.body.decision,
      req.body.remarks || ''
    );
    flash(req, 'success', `Verifier action recorded. Status: ${pr.status}.`);
  } catch (err) {
    flash(req, 'error', err.message);
  }
  res.redirect(`/pr/${req.params.id}`);
});

app.post('/pr/:id/approver-action', (req, res) => {
  try {
    const me = res.locals.currentUser;
    const pr = wf.approverAction(
      Number(req.params.id),
      { email: me.email, displayName: me.displayName, roles: me.roles || [] },
      req.body.decision,
      req.body.remarks || ''
    );
    flash(req, 'success', `Approver action recorded. Status: ${pr.status}.`);
  } catch (err) {
    flash(req, 'error', err.message);
  }
  res.redirect(`/pr/${req.params.id}`);
});

app.post('/pr/:id/closeout', (req, res) => {
  try {
    const me = res.locals.currentUser;
    wf.closeoutByPurchase(
      Number(req.params.id),
      { email: me.email, displayName: me.displayName, roles: me.roles || [] },
      {
        indentNo: req.body.purchaseIndentNo,
        receiptDate: req.body.purchaseReceiptDate,
        docRef: req.body.purchaseDocRef
      }
    );
    flash(req, 'success', 'PR closed by Purchase.');
  } catch (err) {
    flash(req, 'error', err.message);
  }
  res.redirect(`/pr/${req.params.id}`);
});

app.post('/pr/:id/cancel', (req, res) => {
  try {
    const me = res.locals.currentUser;
    wf.cancel(Number(req.params.id),
      { email: me.email, displayName: me.displayName },
      req.body.remarks || '');
    flash(req, 'success', 'PR cancelled.');
  } catch (err) {
    flash(req, 'error', err.message);
  }
  res.redirect(`/pr/${req.params.id}`);
});

app.get('/pr/:id/download', async (req, res) => {
  try {
    const out = await generatePRWorkbook(Number(req.params.id));
    res.download(out.path, out.fileName);
  } catch (err) {
    res.status(500).send(`Excel generation failed: ${err.message}`);
  }
});

app.get('/_debug/state', (req, res) => res.json(db.rawState()));

// Legacy redirects
app.get('/prs', (req, res) => res.redirect('/pr/list'));
app.get('/prs/:id', (req, res) => res.redirect(`/pr/${req.params.id}`));

app.listen(PORT, () => {
  console.log(`MMCL PR/NFA local prototype running at http://localhost:${PORT}`);
  console.log(`Sign in with one of the seeded test accounts (password: Test@123).`);
});
