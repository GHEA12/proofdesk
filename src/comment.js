// The verdict comment formatter. Turns a receipt into the exact comment
// body ProofDesk posts back to the Jira issue: the same information the
// panel shows, readable without opening the panel (PLAN.md).
//
// Style follows Karis's published-text standard: a bold title line,
// short headed sections, evidence hashes in code formatting, and no
// walls of text. The output is plain text with light markdown; the Jira
// client converts it to ADF (see textToAdf in src/jira-parse.js).
//
// The engine's renderReceiptComment (src/engine/receipt.js) remains the
// plain-text rendering for logs and tests; this formatter is the
// issue-facing one.

const numberFormat = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatAmount(amount) {
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) {
    return '(no amount)';
  }
  return numberFormat.format(Number(amount));
}

const STATUS_ICON = { pass: 'PASS', fail: 'FAIL', skipped: 'SKIPPED' };

/**
 * Format a receipt as the verdict comment body.
 * @param {object} receipt A receipt from the engine (src/engine/receipt.js).
 * @returns {string} The exact text posted to the issue.
 */
export function formatReceiptComment(receipt) {
  const claim = receipt.claim;
  const lines = [];

  lines.push(`**ProofDesk verdict: ${receipt.verdict}**`);
  lines.push('');
  lines.push(
    `Receipt \`${receipt.id}\` for ${receipt.issueKey}, recorded ${receipt.timestamp}.`,
  );

  lines.push('');
  lines.push('**Claim**');
  lines.push('');
  const poText = claim.poReference ? `, against PO ${claim.poReference}` : '';
  lines.push(
    `${claim.claimType} claim of ${formatAmount(claim.amount)} ${claim.currency} by ${claim.vendor}, invoice ${claim.invoiceNumber}${poText}.`,
  );

  lines.push('');
  lines.push('**Checks**');
  lines.push('');
  for (const check of receipt.checks) {
    lines.push(`- **${check.label}: ${STATUS_ICON[check.status] ?? check.status.toUpperCase()}**`);
    for (const detail of check.details) {
      lines.push(`  - ${detail}`);
    }
  }

  lines.push('');
  lines.push('**Evidence (SHA-256)**');
  lines.push('');
  if (receipt.evidence.length === 0) {
    lines.push('- No evidence files were attached.');
  } else {
    for (const file of receipt.evidence) {
      lines.push(`- ${file.name} (${file.type}): \`${file.sha256}\``);
    }
  }

  lines.push('');
  lines.push('**Receipt chain**');
  lines.push('');
  lines.push(`Receipt hash: \`${receipt.hash}\``);
  lines.push(
    receipt.prevHash
      ? `Previous receipt: \`${receipt.prevHash}\``
      : 'Previous receipt: none. This is the first receipt in the chain.',
  );

  return lines.join('\n');
}
