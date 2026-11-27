// ProofDesk receipt ledger (manifest resource `ledger`, UI Kit global
// page). Lists every receipt on the site in chain order with its
// verdict, and re-validates the hash chain end to end on demand — the
// audit view for approvers and finance leads (PLAN.md).
//
// Data comes from the resolver's listReceipts / verifyChain functions,
// shaped by ledgerViewModel (viewmodel.js). Like index.jsx, this file
// is JSX for the Forge bundler; preview.html renders the same view
// model statically for offline review.

import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  DynamicTable,
  Heading,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { ledgerViewModel } from './viewmodel';

const TONE_TO_LOZENGE = {
  success: 'success',
  warning: 'moved',
  danger: 'removed',
  default: 'default',
};

const HEAD = {
  cells: [
    { key: 'position', content: '#' },
    { key: 'receipt', content: 'Receipt' },
    { key: 'issue', content: 'Issue' },
    { key: 'verdict', content: 'Verdict' },
    { key: 'amount', content: 'Amount' },
    { key: 'vendor', content: 'Vendor' },
    { key: 'invoice', content: 'Invoice' },
    { key: 'hash', content: 'Hash' },
    { key: 'prev', content: 'Prev' },
  ],
};

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [chainResult, setChainResult] = useState(null);
  const [checking, setChecking] = useState(false);

  const load = async () => {
    try {
      setData(await invoke('listReceipts'));
      setError(null);
    } catch (e) {
      setError(String(e?.message ?? e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const verifyChainNow = async () => {
    setChecking(true);
    try {
      setChainResult(await invoke('verifyChain'));
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setChecking(false);
    }
  };

  if (!data && !error) {
    return <Spinner label="Loading ProofDesk Ledger" />;
  }
  if (error && !data) {
    return (
      <SectionMessage title="ProofDesk Ledger could not load" appearance="error">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }

  const vm = ledgerViewModel(data);
  const rows = vm.rows.map((row) => ({
    key: row.id,
    cells: [
      { key: 'position', content: row.position },
      { key: 'receipt', content: row.id },
      { key: 'issue', content: row.issueKey },
      {
        key: 'verdict',
        content: <Lozenge appearance={TONE_TO_LOZENGE[row.tone]}>{row.verdict}</Lozenge>,
      },
      { key: 'amount', content: row.amount },
      { key: 'vendor', content: row.vendor },
      { key: 'invoice', content: row.invoiceNumber },
      { key: 'hash', content: row.hashShort },
      { key: 'prev', content: row.prevHashShort },
    ],
  }));

  return (
    <Stack space="space.150">
      <Heading as="h1">ProofDesk Ledger</Heading>
      <Text>{vm.chain.label}</Text>
      {vm.isEmpty ? (
        <Text>No receipts yet. Verify a claim from its issue panel and its receipt will appear here.</Text>
      ) : (
        <DynamicTable head={HEAD} rows={rows} />
      )}
      <Box>
        <Button onClick={verifyChainNow} isDisabled={checking}>
          {checking ? 'Verifying chain…' : 'Verify chain'}
        </Button>
      </Box>
      {chainResult ? (
        <SectionMessage
          title={chainResult.valid ? 'Chain valid' : 'Chain INVALID'}
          appearance={chainResult.valid ? 'success' : 'error'}
        >
          {chainResult.details.map((detail, i) => (
            <Text key={i}>{detail}</Text>
          ))}
        </SectionMessage>
      ) : null}
      {error ? (
        <SectionMessage title="Something went wrong" appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      ) : null}
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
