// ProofDesk static preview harness.
//
// Renders the panel and ledger view models to plain HTML so the layout
// and content can be reviewed in any browser without a Forge runtime:
// open preview.html, or serve this folder and open it. The fixture below
// is REAL output: it was produced by running the seeded demo pack
// through the actual resolver service and FakeJiraClient
// (service.getPanelState('FIN-101') and service.listReceipts() after
// verifying all four demo cases). The JSX components render the same
// view models inside Jira via UI Kit.

import { panelViewModel, ledgerViewModel } from './viewmodel.js';

const FIXTURE = {
  "panel": {
    "issueKey": "FIN-101",
    "summary": "A clean vendor delivery claim: invoice and machine-readable delivery note attached, amounts agree with the PO everywhere.",
    "claim": {
      "amount": 1250,
      "claimType": "vendor-delivery",
      "currency": "USD",
      "invoiceNumber": "INV-2026-001",
      "issueKey": "FIN-101",
      "poReference": "PO-1001",
      "vendor": "Acme Logistics"
    },
    "evidence": [
      {
        "id": "att-1",
        "name": "INV-2026-001-invoice.txt",
        "type": "invoice",
        "mimeType": "application/octet-stream"
      },
      {
        "id": "att-2",
        "name": "DN-2026-001-delivery-note.json",
        "type": "delivery-note",
        "mimeType": "application/octet-stream"
      }
    ],
    "latestReceipt": {
      "id": "pd_626adaf72dc77dcf",
      "version": 1,
      "issueKey": "FIN-101",
      "timestamp": "2026-11-27T00:00:00.000Z",
      "claim": {
        "issueKey": "FIN-101",
        "claimType": "vendor-delivery",
        "amount": 1250,
        "currency": "USD",
        "vendor": "Acme Logistics",
        "invoiceNumber": "INV-2026-001",
        "poReference": "PO-1001"
      },
      "evidence": [
        {
          "name": "INV-2026-001-invoice.txt",
          "type": "invoice",
          "sha256": "ed56a54133dd0c3b1648cbce361213401d25687193079903d1c0001221db4a79"
        },
        {
          "name": "DN-2026-001-delivery-note.json",
          "type": "delivery-note",
          "sha256": "fc4b54d2299250350298a26e5030ffe1454c3a31f706f4d8a43733a80c5ec099"
        }
      ],
      "checks": [
        {
          "id": "completeness",
          "label": "Evidence completeness",
          "status": "pass",
          "details": [
            "Evidence present: invoice.",
            "Evidence present: delivery-note.",
            "PO reference present: PO-1001."
          ]
        },
        {
          "id": "amount-consistency",
          "label": "Amount consistency",
          "status": "pass",
          "details": [
            "Currency matches PO PO-1001: USD.",
            "Amount matches PO PO-1001: 1250 USD.",
            "Delivery note line items sum to the note total: 1250.",
            "Delivery note total matches the claimed amount."
          ]
        },
        {
          "id": "duplicate",
          "label": "Duplicate detection",
          "status": "pass",
          "details": [
            "Invoice INV-2026-001 not previously receipted on another issue.",
            "No evidence file matches a receipt on another issue."
          ]
        }
      ],
      "verdict": "VERIFIED",
      "prevHash": null,
      "hash": "626adaf72dc77dcf8b1f61003fc4fa1527ad2486181df5815eb7a1e78fbe01a8"
    },
    "chainValid": true,
    "receiptCount": 4
  },
  "ledger": {
    "receipts": [
      {
        "id": "pd_626adaf72dc77dcf",
        "version": 1,
        "issueKey": "FIN-101",
        "timestamp": "2026-11-27T00:00:00.000Z",
        "claim": {
          "issueKey": "FIN-101",
          "claimType": "vendor-delivery",
          "amount": 1250,
          "currency": "USD",
          "vendor": "Acme Logistics",
          "invoiceNumber": "INV-2026-001",
          "poReference": "PO-1001"
        },
        "evidence": [
          {
            "name": "INV-2026-001-invoice.txt",
            "type": "invoice",
            "sha256": "ed56a54133dd0c3b1648cbce361213401d25687193079903d1c0001221db4a79"
          },
          {
            "name": "DN-2026-001-delivery-note.json",
            "type": "delivery-note",
            "sha256": "fc4b54d2299250350298a26e5030ffe1454c3a31f706f4d8a43733a80c5ec099"
          }
        ],
        "checks": [
          {
            "id": "completeness",
            "label": "Evidence completeness",
            "status": "pass",
            "details": [
              "Evidence present: invoice.",
              "Evidence present: delivery-note.",
              "PO reference present: PO-1001."
            ]
          },
          {
            "id": "amount-consistency",
            "label": "Amount consistency",
            "status": "pass",
            "details": [
              "Currency matches PO PO-1001: USD.",
              "Amount matches PO PO-1001: 1250 USD.",
              "Delivery note line items sum to the note total: 1250.",
              "Delivery note total matches the claimed amount."
            ]
          },
          {
            "id": "duplicate",
            "label": "Duplicate detection",
            "status": "pass",
            "details": [
              "Invoice INV-2026-001 not previously receipted on another issue.",
              "No evidence file matches a receipt on another issue."
            ]
          }
        ],
        "verdict": "VERIFIED",
        "prevHash": null,
        "hash": "626adaf72dc77dcf8b1f61003fc4fa1527ad2486181df5815eb7a1e78fbe01a8"
      },
      {
        "id": "pd_28f0c9161161929d",
        "version": 1,
        "issueKey": "FIN-102",
        "timestamp": "2026-11-27T00:00:00.000Z",
        "claim": {
          "issueKey": "FIN-102",
          "claimType": "vendor-delivery",
          "amount": 480,
          "currency": "USD",
          "vendor": "Brightline Studio",
          "invoiceNumber": "INV-2026-002",
          "poReference": "PO-1002"
        },
        "evidence": [
          {
            "name": "INV-2026-002-invoice.txt",
            "type": "invoice",
            "sha256": "0cdf7eea2e646fafae27f73fe932098ddd7540e2a26a6fe108e1b615db3d3b5f"
          }
        ],
        "checks": [
          {
            "id": "completeness",
            "label": "Evidence completeness",
            "status": "fail",
            "details": [
              "Evidence present: invoice.",
              "Evidence missing: delivery-note.",
              "PO reference present: PO-1002."
            ]
          },
          {
            "id": "amount-consistency",
            "label": "Amount consistency",
            "status": "pass",
            "details": [
              "Currency matches PO PO-1002: USD.",
              "Amount matches PO PO-1002: 480 USD."
            ]
          },
          {
            "id": "duplicate",
            "label": "Duplicate detection",
            "status": "pass",
            "details": [
              "Invoice INV-2026-002 not previously receipted on another issue.",
              "No evidence file matches a receipt on another issue."
            ]
          }
        ],
        "verdict": "NEEDS EVIDENCE",
        "prevHash": "626adaf72dc77dcf8b1f61003fc4fa1527ad2486181df5815eb7a1e78fbe01a8",
        "hash": "28f0c9161161929df71ef5a2cafad7c014082a2380eac3079baafe52fca44a0d"
      },
      {
        "id": "pd_e6ae946a80cb7ebd",
        "version": 1,
        "issueKey": "FIN-103",
        "timestamp": "2026-11-27T00:00:00.000Z",
        "claim": {
          "issueKey": "FIN-103",
          "claimType": "vendor-delivery",
          "amount": 1250,
          "currency": "USD",
          "vendor": "Acme Logistics",
          "invoiceNumber": "INV-2026-001",
          "poReference": "PO-1001"
        },
        "evidence": [
          {
            "name": "INV-2026-001-resubmission-invoice.txt",
            "type": "invoice",
            "sha256": "ae4e52c5f8707849cb797f7e1710b86ad0252ac5a90023f6a60c32e3d5d53d1d"
          },
          {
            "name": "DN-2026-003-delivery-note.json",
            "type": "delivery-note",
            "sha256": "e9a0d1a64e807691258c304a3928317f20d503fea905d64a3147d3f1d215fef7"
          }
        ],
        "checks": [
          {
            "id": "completeness",
            "label": "Evidence completeness",
            "status": "pass",
            "details": [
              "Evidence present: invoice.",
              "Evidence present: delivery-note.",
              "PO reference present: PO-1001."
            ]
          },
          {
            "id": "amount-consistency",
            "label": "Amount consistency",
            "status": "pass",
            "details": [
              "Currency matches PO PO-1001: USD.",
              "Amount matches PO PO-1001: 1250 USD.",
              "Delivery note line items sum to the note total: 1250.",
              "Delivery note total matches the claimed amount."
            ]
          },
          {
            "id": "duplicate",
            "label": "Duplicate detection",
            "status": "fail",
            "details": [
              "Duplicate invoice: INV-2026-001 was already receipted on FIN-101 (receipt pd_626adaf72dc77dcf)."
            ]
          }
        ],
        "verdict": "MISMATCH",
        "prevHash": "28f0c9161161929df71ef5a2cafad7c014082a2380eac3079baafe52fca44a0d",
        "hash": "e6ae946a80cb7ebdbc4cf025b9b96ce4a708a36f0be964aff226aca379c3c16e"
      },
      {
        "id": "pd_568e60d1b790a45b",
        "version": 1,
        "issueKey": "FIN-104",
        "timestamp": "2026-11-27T00:00:00.000Z",
        "claim": {
          "issueKey": "FIN-104",
          "claimType": "vendor-delivery",
          "amount": 1300,
          "currency": "USD",
          "vendor": "Acme Logistics",
          "invoiceNumber": "INV-2026-004",
          "poReference": "PO-1001"
        },
        "evidence": [
          {
            "name": "INV-2026-004-invoice.txt",
            "type": "invoice",
            "sha256": "ec07aedd61ffc8e7e563d943c1dec26bcf204de4b482072420cac40e3afe50e2"
          },
          {
            "name": "DN-2026-004-delivery-note.json",
            "type": "delivery-note",
            "sha256": "7f5daa2e31d56df4865999689d5ab386e7e0679c5a70085864084702014e89ae"
          }
        ],
        "checks": [
          {
            "id": "completeness",
            "label": "Evidence completeness",
            "status": "pass",
            "details": [
              "Evidence present: invoice.",
              "Evidence present: delivery-note.",
              "PO reference present: PO-1001."
            ]
          },
          {
            "id": "amount-consistency",
            "label": "Amount consistency",
            "status": "fail",
            "details": [
              "Currency matches PO PO-1001: USD.",
              "Amount mismatch: claim is 1300 USD but PO PO-1001 is 1250 USD.",
              "Delivery note line items sum to the note total: 1300.",
              "Delivery note total matches the claimed amount."
            ]
          },
          {
            "id": "duplicate",
            "label": "Duplicate detection",
            "status": "pass",
            "details": [
              "Invoice INV-2026-004 not previously receipted on another issue.",
              "No evidence file matches a receipt on another issue."
            ]
          }
        ],
        "verdict": "MISMATCH",
        "prevHash": "e6ae946a80cb7ebdbc4cf025b9b96ce4a708a36f0be964aff226aca379c3c16e",
        "hash": "568e60d1b790a45bf81c90c48c9244c6a60a8db1ca2b40c7ce4a1c1e7f47a460"
      }
    ],
    "chain": {
      "valid": true,
      "checked": 4,
      "firstInvalidIndex": null,
      "details": [
        "Chain verified end to end: 4 receipt(s), all hashes and links intact."
      ]
    }
  }
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderPanel(state) {
  const vm = panelViewModel(state);
  const checks = vm.receipt
    ? vm.receipt.checks.map((c) => `<li><strong>${esc(c.label)}: ${esc(c.statusLabel)}</strong><ul>${c.details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></li>`).join('')
    : '';
  const evidence = vm.receipt
    ? vm.receipt.evidence.map((f) => `<li>${esc(f.name)} (${esc(f.type)}): <code>${esc(f.sha256)}</code></li>`).join('')
    : '';
  return `
  <section class="card">
    <h2>ProofDesk — ${esc(vm.issueKey)}</h2>
    <p>${esc(vm.summary)}</p>
    <h3>Claim</h3>
    <table>${vm.claimLines.map((l) => `<tr><th>${esc(l.label)}</th><td>${esc(l.value)}</td></tr>`).join('')}</table>
    <h3>Evidence attached</h3>
    <ul>${vm.evidenceRows.map((f) => `<li>${esc(f.name)} (${esc(f.type)})</li>`).join('')}</ul>
    <button disabled>${esc(vm.verifyButton.label)}</button>
    ${vm.receipt ? `
    <h3>Latest receipt — <span class="tone-${esc(vm.receipt.tone)}">${esc(vm.receipt.verdict)}</span></h3>
    <p>Receipt <code>${esc(vm.receipt.id)}</code> · ${esc(vm.receipt.timestamp)}</p>
    <ul>${checks}</ul>
    <h4>Evidence (SHA-256)</h4>
    <ul>${evidence}</ul>
    <p>Receipt hash: <code>${esc(vm.receipt.hash)}</code><br/>Previous receipt: <code>${esc(vm.receipt.prevHash ?? 'none — first in chain')}</code></p>` : '<p>No receipt yet. Run checks to verify this claim.</p>'}
    <p>Receipt chain on this site: ${vm.chainValid ? 'VALID' : 'INVALID'} (${vm.receiptCount} receipt(s))</p>
  </section>`;
}

function renderLedger(data) {
  const vm = ledgerViewModel(data);
  const rows = vm.rows.map((r) => `<tr><td>${r.position}</td><td><code>${esc(r.id)}</code></td><td>${esc(r.issueKey)}</td><td class="tone-${esc(r.tone)}">${esc(r.verdict)}</td><td>${esc(r.amount)}</td><td>${esc(r.vendor)}</td><td>${esc(r.invoiceNumber)}</td><td><code>${esc(r.hashShort)}</code></td><td><code>${esc(r.prevHashShort)}</code></td></tr>`).join('');
  return `
  <section class="card">
    <h2>ProofDesk Ledger</h2>
    <p>${esc(vm.chain.label)}</p>
    ${vm.isEmpty ? '<p>No receipts yet.</p>' : `<table>
      <tr><th>#</th><th>Receipt</th><th>Issue</th><th>Verdict</th><th>Amount</th><th>Vendor</th><th>Invoice</th><th>Hash</th><th>Prev</th></tr>
      ${rows}
    </table>`}
  </section>`;
}

document.getElementById('panel').innerHTML = renderPanel(FIXTURE.panel);
document.getElementById('ledger').innerHTML = renderLedger(FIXTURE.ledger);
