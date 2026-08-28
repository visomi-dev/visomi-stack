import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';

type Evaluation = {
  item: string;
  run: string;
  privacy: string;
  questions: { id: string }[];
  measures: {
    byQuestion: {
      id: string;
      medianSeconds: number;
      errors: number;
      ignoredElements: string[];
      signalUsefulness: string;
    }[];
  };
  findings: { severity: string; class: string; evidence: string; decision: string }[];
  revisions: unknown[];
  phaseTrace: { phase1: string; phase2: string; phase3: string; covered: string[] };
};
const root = join(import.meta.dirname, '..');
const evaluation = JSON.parse(
  readFileSync(join(root, 'docs/architecture/system/operational-workspace-comprehension-evaluation.json'), 'utf8'),
) as Evaluation;

test('evaluation covers six questions and measurable observations', () => {
  assert.equal(evaluation.item, 'THM-OWV-004');
  assert.equal(evaluation.run, 'RUN-147');
  assert.deepEqual(
    evaluation.questions.map(({ id }) => id),
    ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6'],
  );
  assert.equal(evaluation.measures.byQuestion.length, 6);
  for (const measure of evaluation.measures.byQuestion) {
    assert.ok(measure.medianSeconds > 0);
    assert.ok(measure.errors >= 0);
    assert.ok(measure.ignoredElements.length > 0);
    assert.ok(['useful', 'unclear', 'decorative'].includes(measure.signalUsefulness));
  }
});

test('findings classify vocabulary, flow, visual, state-event, and authority problems', () => {
  const classes = new Set(evaluation.findings.map(({ class: findingClass }) => findingClass));
  for (const required of ['vocabulary', 'flow', 'visual', 'state-event', 'authority']) assert.ok(classes.has(required));
  for (const finding of evaluation.findings) {
    assert.ok(['low', 'medium', 'high', 'critical'].includes(finding.severity));
    assert.ok(finding.evidence.length > 0);
    assert.ok(finding.decision.length > 0);
  }
  assert.ok(evaluation.revisions.length >= 1);
  assert.ok(evaluation.findings.some(({ decision }) => decision.includes('Accepted risk')));
});

test('evaluation is traceable, privacy-preserving, and covers failure state families', () => {
  assert.ok(evaluation.privacy.includes('No participant identity'));
  assert.ok(evaluation.privacy.includes('protected artifact content'));
  for (const path of [evaluation.phaseTrace.phase1, evaluation.phaseTrace.phase2, evaluation.phaseTrace.phase3])
    assert.ok(readFileSync(join(root, path), 'utf8').length > 0);
  for (const state of [
    'workspace',
    'detail',
    'evidence',
    'timeline',
    'responsive modes',
    'locked',
    'unavailable',
    'error',
  ])
    assert.ok(evaluation.phaseTrace.covered.includes(state), `missing coverage: ${state}`);
});
