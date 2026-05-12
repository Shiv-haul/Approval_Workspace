const db = require('./db');

const departments = [
  { code: 'PROJ', name: 'Project Management' },
  { code: 'MECH', name: 'Mechanical' },
  { code: 'ELEC', name: 'Electrical' },
  { code: 'INST', name: 'Instrumentation' },
  { code: 'IT',   name: 'Information Technology' },
  { code: 'HR',   name: 'Human Resources' },
  { code: 'FIN',  name: 'Finance' },
  { code: 'PROC', name: 'Procurement' },
  { code: 'OPS',  name: 'Operations' },
  { code: 'SAFE', name: 'Safety' }
];

// LOCAL PROTOTYPE PASSWORDS — plaintext for offline testing only.
// Production deployment will use Microsoft 365 SSO and these credentials
// will be deleted.
const DEFAULT_PWD = 'Test@123';

const users = [
  // Indentor
  { email: 'shivansh.sharma@mesabimetallics.com', displayName: 'Shivansh Sharma', shortName: 'S. Sharma',  departmentCode: 'IT',   roles: ['Indentor'], password: DEFAULT_PWD },
  // Verifier
  { email: 'niranjan.shinde@mesabimetallics.com', displayName: 'Niranjan Shinde', shortName: 'N. Shinde',  departmentCode: 'IT',   roles: ['Verifier'], password: DEFAULT_PWD },
  // Approver pool (Project Head — either may sign)
  { email: 'joe.broking@mesabimetallics.com',     displayName: 'Joe Broking',     shortName: 'J. Broking', departmentCode: 'PROJ', roles: ['Approver'], password: DEFAULT_PWD },
  { email: 'rizwan.m@mesabimetallics.com',        displayName: 'Rizwan M',        shortName: 'R. M',       departmentCode: 'PROJ', roles: ['Approver'], password: DEFAULT_PWD },
  // Project Team (assigns PR# + WBS)
  { email: 'anita.roy@mesabimetallics.com',       displayName: 'Anita Roy',       shortName: 'A. Roy',     departmentCode: 'PROJ', roles: ['ProjectTeam'], password: DEFAULT_PWD },
  // Purchase
  { email: 'rahul.menon@mesabimetallics.com',     displayName: 'Rahul Menon',     shortName: 'R. Menon',   departmentCode: 'PROC', roles: ['Purchase'], password: DEFAULT_PWD }
];

const verifierForDept = {
  // Only Niranjan is configured as verifier for now (across all depts in the pilot)
  IT:   'niranjan.shinde@mesabimetallics.com',
  MECH: 'niranjan.shinde@mesabimetallics.com',
  ELEC: 'niranjan.shinde@mesabimetallics.com'
};

function seed({ reset = false } = {}) {
  const state = db.rawState();
  if (!reset && state.users && state.users.length > 0) {
    console.log('DB already seeded. Use --reset to wipe.');
    return;
  }

  const fresh = {
    users,
    departments,
    prs: [],
    approvals: [],
    counters: { 'PR_GLOBAL': 0 },
    _meta: { lastPRId: 0, lastApprovalId: 0 },
    config: {
      verifierForDept,
      approverPool: ['joe.broking@mesabimetallics.com', 'rizwan.m@mesabimetallics.com'],
      approverTitle: 'Project Head'
    }
  };
  db.resetAndSeed(fresh);

  // Seed a sample IT PR mirroring the RFID/Card Readers approved PR shape
  const samplePR = {
    indentNo: null,
    wbs: null,
    status: 'Draft',
    currentStage: 'Indentor',
    fromStage: null,
    departmentCode: 'IT',
    departmentName: 'Information Technology',
    fiscalYear: null,
    indentDate: new Date().toISOString().slice(0, 10),
    indentorEmail: 'shivansh.sharma@mesabimetallics.com',
    indentorDisplay: 'Shivansh Sharma',
    verifierEmail: 'niranjan.shinde@mesabimetallics.com',
    verifierDisplay: 'Niranjan Shinde',
    approverEmail: null,
    approverDisplay: null,
    specialInstructions: 'RFID / CARD READERS INSTALLATION PROJECT',
    totalEstValueUSD: 0,
    itemCount: 3,
    purchase: { indentNo: null, receiptDate: null, docRef: null },
    items: [
      { lineNo: 1, description: 'AT&T Cradlepoint', size: '', specification: '', uom: 'Nos', qtyRequirement: 9, qtyStockInHand: 0, qtyToBuy: 9, areaOfUtilization: 'MMCL-General', rosDate: 'Immediate', estValueUsdPerUnit: 0, lineTotalUSD: 0 },
      { lineNo: 2, description: '8-Port Switch',    size: '', specification: '', uom: 'Nos', qtyRequirement: 9, qtyStockInHand: 0, qtyToBuy: 9, areaOfUtilization: 'MMCL-General', rosDate: 'Immediate', estValueUsdPerUnit: 0, lineTotalUSD: 0 },
      { lineNo: 3, description: 'RFID Cover Mount', size: '', specification: '', uom: 'Nos', qtyRequirement: 9, qtyStockInHand: 0, qtyToBuy: 9, areaOfUtilization: 'MMCL-General', rosDate: 'Immediate', estValueUsdPerUnit: 0, lineTotalUSD: 0 }
    ]
  };
  const created = db.createPR(samplePR);
  console.log(`Seeded ${users.length} users, ${departments.length} departments, 1 sample PR (id=${created.id}).`);
  console.log(`\nLogin credentials (password is "${DEFAULT_PWD}" for everyone):`);
  users.forEach(u => console.log(`  ${u.email.padEnd(45)} - ${u.roles.join(',').padEnd(12)} - ${u.displayName}`));
}

if (require.main === module) {
  const reset = process.argv.includes('--reset');
  seed({ reset });
}

module.exports = { seed, departments, users, verifierForDept, DEFAULT_PWD };
