// Pure view-model builders for the ProofDesk frontend. The UI Kit
// components (index.jsx, ledger.jsx) and the static preview harness
// (preview.js) both render from these shapes, so the display logic is
// unit-testable offline with no React and no Forge runtime.

const numberFormat = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

export function formatMoney(amount, currency) {
    if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) {
          return '(no amount)';
    }
    return `${numberFormat.format(Number(amount))} ${currency ?? ''}`.trim();
}

export function shortHash(hash, length = 12) {
    if (!hash) return '(none)';
    return hash.length > length ? `${hash.slice(0, length)}…` : hash;
}

const VERDICT_TONES = {
    VERIFIED: 'success',
    'NEEDS EVIDENCE': 'warning',
    MISMATCH: 'danger',
};

export function verdictTone(verdict) {
    return VERDICT_TONES[verdict] ?? 'default';
}

function receiptView(receipt) {
    if (!receipt) return null;
    return {
          id: receipt.id,
          verdict: receipt.verdict,
          tone: verdictTone(receipt.verdict),
          timestamp: receipt.timestamp,
          hash: receipt.hash,
          hashShort: shortHash(receipt.hash),
          prevHash: receipt.prevHash,
          prevHashShort: shortHash(receipt.prevHash),
          checks: receipt.checks.map((check) => ({
                  id: check.id,
                  label: check.label,
                  status: check.status,
                  statusLabel: check.status.toUpperCase(),
                  details: check.details,
          })),
          evidence: receipt.evidence.map((file) => ({
                  name: file.name,
                  type: file.type,
                  sha256: file.sha256,
                  sha256Short: shortHash(file.sha256),
          })),
    };
}

/**
 * Panel view model from the resolver's getPanelState result.
 * `verifying` is the panel's local button state (a run is in flight).
 */
export function panelViewModel(state, { verifying = false } = {}) {
    const claim = state.claim ?? {};
    return {
          issueKey: state.issueKey,
          summary: state.summary ?? '',
          claimLines: [
            { label: 'Type', value: claim.claimType ?? '' },
            { label: 'Amount', value: formatMoney(claim.amount, claim.currency) },
            { label: 'Vendor', value: claim.vendor ?? '' },
            { label: 'Invoice', value: claim.invoiceNumber ?? '' },
            { label: 'PO', value: claim.poReference ?? '(none)' },
                ],
          evidenceRows: (state.evidence ?? []).map((file) => ({
                  id: file.id,
                  name: file.name,
                  type: file.type,
          })),
          receipt: receiptView(state.latestReceipt ?? null),
          hasReceipt: Boolean(state.latestReceipt),
          chainValid: state.chainValid,
          receiptCount: state.receiptCount ?? 0,
          verifyButton: {
                  label: verifying ? 'Running checks…' : state.latestReceipt ? 'Re-run checks' : 'Run checks',
                  disabled: verifying,
          },
    };
}

/** Ledger view model from the resolver's listReceipts result. */
export function ledgerViewModel({ receipts, chain }) {
    return {
          rows: (receipts ?? []).map((receipt, index) => ({
                  position: index + 1,
                  id: receipt.id,
                  issueKey: receipt.issueKey,
                  verdict: receipt.verdict,
                  tone: verdictTone(receipt.verdict),
                  timestamp: receipt.timestamp,
                  amount: formatMoney(receipt.claim?.amount, receipt.claim?.currency),
                  vendor: receipt.claim?.vendor ?? '',
                  invoiceNumber: receipt.claim?.invoiceNumber ?? '',
                  hashShort: shortHash(receipt.hash),
                  prevHashShort: shortHash(receipt.prevHash),
          })),
          chain: {
                  valid: chain?.valid ?? false,
                  checked: chain?.checked ?? 0,
                  details: chain?.details ?? [],
                  label: chain?.valid
                    ? `Chain valid — ${chain.checked} receipt(s) verified end to end`
                            : 'Chain INVALID — see details',
          },
          isEmpty: !receipts || receipts.length === 0,
    };
}
