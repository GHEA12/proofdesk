// ProofDesk issue panel (manifest resource `main`, UI Kit).
//
// Renders the claim summary, the attached evidence, a Run checks button,
// and the latest receipt verdict with per-check results — all from the
// resolver's getPanelState / runVerification functions, shaped for
// display by panelViewModel (viewmodel.js). The checks themselves run in
// the resolver; this component only invokes and renders.
//
// Note: this file is JSX for the Forge bundler and cannot be compiled by
// plain Node offline; viewmodel.js carries the testable display logic,
// and preview.html renders the same view models statically.

import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  Heading,
  Inline,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  useProductContext,
} from '@forge/react';
import { invoke } from '@forge/bridge';
import { panelViewModel } from './viewmodel';

const TONE_TO_LOZENGE = {
  success: 'success',
  warning: 'moved',
  danger: 'removed',
  default: 'default',
};

function ReceiptCard({ receipt, chainValid, receiptCount }) {
  return (
    <Stack space="space.100">
      <Inline space="space.100" alignBlock="center">
        <Heading as="h3">Latest receipt</Heading>
        <Lozenge appearance={TONE_TO_LOZENGE[receipt.tone]}>{receipt.verdict}</Lozenge>
      </Inline>
      <Text>
        Receipt {receipt.id} · {receipt.timestamp}
      </Text>
      {receipt.checks.map((check) => (
        <Box key={check.id}>
          <Text>
            {check.label}: {check.statusLabel}
          </Text>
          {check.details.map((detail, i) => (
            <Text key={i}>· {detail}</Text>
          ))}
        </Box>
      ))}
      <Heading as="h4">Evidence (SHA-256)</Heading>
      {receipt.evidence.map((file) => (
        <Text key={file.name}>
          {file.name} ({file.type}): {file.sha256}
        </Text>
      ))}
      <Text>Receipt hash: {receipt.hash}</Text>
      <Text>Previous receipt: {receipt.prevHash ?? 'none — first receipt in the chain'}</Text>
      <Text>
        Receipt chain on this site: {chainValid ? 'VALID' : 'INVALID'} ({receiptCount} receipt(s))
      </Text>
    </Stack>
  );
}

function App() {
  const context = useProductContext();
  const issueKey = context?.extension?.issue?.key;
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [verifying, setVerifying] = useState(false);

  const load = async () => {
    if (!issueKey) return;
    try {
      setState(await invoke('getPanelState', { issueKey }));
      setError(null);
    } catch (e) {
      setError(String(e?.message ?? e));
    }
  };

  useEffect(() => {
    load();
  }, [issueKey]);

  const runChecks = async () => {
    setVerifying(true);
    try {
      await invoke('runVerification', { issueKey });
      await load();
    } catch (e) {
      setError(String(e?.message ?? e));
    } finally {
      setVerifying(false);
    }
  };

  if (!issueKey || (!state && !error)) {
    return <Spinner label="Loading ProofDesk" />;
  }
  if (error && !state) {
    return (
      <SectionMessage title="ProofDesk could not load this issue" appearance="error">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }

  const vm = panelViewModel(state, { verifying });
  return (
    <Stack space="space.150">
      <Heading as="h2">ProofDesk</Heading>
      <Text>{vm.summary}</Text>
      <Heading as="h3">Claim</Heading>
      {vm.claimLines.map((line) => (
        <Text key={line.label}>
          {line.label}: {line.value}
        </Text>
      ))}
      <Heading as="h3">Evidence attached</Heading>
      {vm.evidenceRows.length === 0 ? (
        <Text>No files are attached to this issue.</Text>
      ) : (
        vm.evidenceRows.map((file) => (
          <Text key={file.id}>
            {file.name} ({file.type})
          </Text>
        ))
      )}
      <Box>
        <Button appearance="primary" onClick={runChecks} isDisabled={vm.verifyButton.disabled}>
          {vm.verifyButton.label}
        </Button>
      </Box>
      {error ? (
        <SectionMessage title="Something went wrong" appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      ) : null}
      {vm.receipt ? (
        <ReceiptCard receipt={vm.receipt} chainValid={vm.chainValid} receiptCount={vm.receiptCount} />
      ) : (
        <Text>No receipt yet. Run checks to verify this claim.</Text>
      )}
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
