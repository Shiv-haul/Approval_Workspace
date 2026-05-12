const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'db.json');

const EMPTY_STATE = {
  users: [],
  departments: [],
  prs: [],
  approvals: [],
  counters: {},
  _meta: { lastPRId: 0, lastApprovalId: 0 }
};

function load() {
  if (!fs.existsSync(DB_PATH)) {
    save(EMPTY_STATE);
    return JSON.parse(JSON.stringify(EMPTY_STATE));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function save(state) {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, DB_PATH);
}

function nextId(state, key) {
  state._meta[key] = (state._meta[key] || 0) + 1;
  return state._meta[key];
}

function getUserByEmail(email) {
  const s = load();
  return s.users.find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}

function listUsers() {
  return load().users;
}

function listDepartments() {
  return load().departments;
}

function listPRs(filter = {}) {
  const s = load();
  let prs = s.prs;
  if (filter.indentorEmail) prs = prs.filter(p => p.indentorEmail === filter.indentorEmail);
  if (filter.status) prs = prs.filter(p => p.status === filter.status);
  if (filter.statusIn) prs = prs.filter(p => filter.statusIn.includes(p.status));
  if (filter.awaitingEmail) {
    prs = prs.filter(p =>
      (p.currentStage === 'Verifier' && p.verifierEmail === filter.awaitingEmail) ||
      (p.currentStage === 'Approver' && p.approverEmail === filter.awaitingEmail) ||
      (p.currentStage === 'Purchase' && filter.userIsPurchase)
    );
  }
  return prs.slice().sort((a, b) => b.id - a.id);
}

function getPR(id) {
  const s = load();
  return s.prs.find(p => p.id === Number(id)) || null;
}

function createPR(pr) {
  const s = load();
  const id = nextId(s, 'lastPRId');
  const now = new Date().toISOString();
  const full = { id, createdAt: now, updatedAt: now, ...pr };
  s.prs.push(full);
  save(s);
  return full;
}

function updatePR(id, updates) {
  const s = load();
  const idx = s.prs.findIndex(p => p.id === Number(id));
  if (idx === -1) return null;
  s.prs[idx] = { ...s.prs[idx], ...updates, updatedAt: new Date().toISOString() };
  save(s);
  return s.prs[idx];
}

function listApprovals(prId) {
  const s = load();
  return s.approvals
    .filter(a => a.prId === Number(prId))
    .sort((a, b) => new Date(a.actionTimestamp) - new Date(b.actionTimestamp));
}

function addApproval(entry) {
  const s = load();
  const id = nextId(s, 'lastApprovalId');
  const full = { id, ...entry, actionTimestamp: entry.actionTimestamp || new Date().toISOString() };
  s.approvals.push(full);
  save(s);
  return full;
}

function bumpCounter(key) {
  const s = load();
  s.counters[key] = (s.counters[key] || 0) + 1;
  save(s);
  return s.counters[key];
}

function resetAndSeed(seed) {
  save(seed);
}

function rawState() { return load(); }

module.exports = {
  load,
  save,
  getUserByEmail,
  listUsers,
  listDepartments,
  listPRs,
  getPR,
  createPR,
  updatePR,
  listApprovals,
  addApproval,
  bumpCounter,
  resetAndSeed,
  rawState
};
