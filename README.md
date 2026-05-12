# MMCL PR — Local Prototype

A self-contained Node.js app that mirrors the future SharePoint / Power Platform deployment so the PR workflow, form layout, approval chain, and Excel download can be validated offline before going to the corporate tenant.

## Run

```powershell
cd "C:\Users\Ssharmaad\OneDrive - Essar\Desktop\Test Apps\PR-NFA-App\06-local-prototype"
npm start
```

Open http://localhost:3000 in your browser. Default user is **Jane Doe (Indentor, Mechanical)**.

## Reset the data

```powershell
npm run reset      # wipes db.json and reseeds users + 1 sample draft PR
```

Generated Excel files end up in `generated/`. The master form template is `template/PR-Master-Template.xlsx` (same layout as your sample).

## Test users (switch from the top-right dropdown)

| Email | Role | Dept |
|---|---|---|
| jane.doe@mesabimetallics.com | Indentor | MECH |
| john.smith@mesabimetallics.com | Indentor | IT |
| maria.garcia@mesabimetallics.com | Indentor | ELEC |
| priya.kumar@mesabimetallics.com | Verifier | MECH |
| alex.johnson@mesabimetallics.com | Verifier | IT |
| david.lee@mesabimetallics.com | Verifier | ELEC |
| **shivansh.sharma@mesabimetallics.com** | **Approver / Verifier / Indentor** | **PROJ** |
| rahul.menon@mesabimetallics.com | Purchase | PROC |

## End-to-end test plan

1. **Indentor (Jane)**: open the seeded draft #1 → Edit → fill items → **Submit for verification**. Indent No `MMCL/MECH/FY2627/PR-001` is auto-assigned.
2. **Verifier (Priya)**: switch user → home → "Awaiting my action" → **Approve** with a remark. PR moves to `WithApprover`.
3. **Approver (Shivansh)**: switch user → **Approve**. PR moves to `Approved`, Purchase team gets it.
4. **Purchase (Rahul)**: switch user → fill closeout fields → **Mark closed**. PR moves to `ClosedByPurchase`.
5. **Anywhere**: click **⬇ Download Excel** at any stage to get the populated form in the original layout.

## Test the return-for-edit loop

1. Indentor submits → Verifier hits **Return for edit** with a remark → status becomes `ReturnedForEdit`.
2. Indentor opens the PR → **Edit & Resubmit** → form is editable again. On resubmit, it goes straight back to the verifier (resumes from the stage that returned it).

## Files

```
06-local-prototype/
├── package.json           Node deps (express, exceljs, ejs)
├── server.js              Express routes
├── lib/
│   ├── db.js              JSON-file backed store (db.json)
│   ├── seed.js            test users, departments, sample PR
│   ├── indent.js          IndentNo generator + FY tag
│   ├── workflow.js        state machine (submit/verify/approve/closeout/cancel)
│   └── excelgen.js        populates template via exceljs (cell map matches your layout)
├── views/                 EJS templates (home, list, edit, detail)
├── public/                styles.css, app.js (line-item gallery)
├── template/PR-Master-Template.xlsx     master form, never overwritten
├── generated/             output xlsx, named after IndentNo
└── db.json                runtime data (ignored by Excel/SharePoint — local only)
```

## What this prototype maps to in production

| Local | Production (Phase 1 SharePoint deploy) |
|---|---|
| db.json | SP Lists `PR_Headers`, `PR_Items`, `PR_Approvals`, `PR_Counters` |
| User-switcher dropdown | Microsoft 365 SSO + Azure AD identity |
| `lib/workflow.js` state machine | Power Automate flows F1/F2 |
| `lib/excelgen.js` | Office Script `Populate-PR-Template.ts` invoked from F3 |
| EJS views | Power Apps Canvas screens |
| `template/` folder | SharePoint document library `Templates/` |
| `generated/` folder | SharePoint document library `Generated/` |

The mappings are 1:1 by design so logic that works here will translate cleanly when we deploy.
