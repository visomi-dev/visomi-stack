import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

type Flow = {
  id: string;
  actors: string[];
  steps: Step[];
  states: string[];
  data: string[];
  translation: string;
  outcome: string;
  a11y: string;
  failure: string;
  trace: string[];
};

type Step = {
  order: number;
  action: string;
  observe: string;
  route: string;
  state: string;
};

type Manifest = {
  item: string;
  source: string;
  readOnly: boolean;
  routes: string[];
  flows: Flow[];
  phase1Trace: string[];
};

const root = join(import.meta.dirname, '..');
const manifest = JSON.parse(
  readFileSync(join(root, 'docs/architecture/system/operational-workspace-flow-manifest.json'), 'utf8'),
) as Manifest;

const requiredPhase1Trace = [
  'vocabulary',
  'trust',
  'visual-states',
  'authority',
  'translation',
  'OWV-D01',
  'OWV-D02',
  'OWV-D03',
  'OWV-D04',
  'OWV-D05',
  'OWV-D06',
  'OWV-D07',
  'OWV-R01',
  'OWV-R02',
  'OWV-R03',
];

const validateManifest = (candidate: Manifest): void => {
  const candidateShape = candidate as unknown as Record<string, unknown>;
  assert.ok(Array.isArray(candidateShape.flows), 'flows must be an array');
  assert.ok(candidateShape.flows.length > 0, 'flows must not be empty');
  for (const [index, flowShape] of candidateShape.flows.entries()) {
    assert.ok(flowShape !== null && typeof flowShape === 'object', `flow ${index} must be an object`);
    const flowRecord = flowShape as Record<string, unknown>;
    for (const field of ['actors', 'steps', 'states', 'data', 'trace'] as const) {
      assert.ok(Array.isArray(flowRecord[field]), `flow ${index} ${field} must be an array`);
    }
    for (const field of ['id', 'translation', 'outcome', 'a11y', 'failure'] as const) {
      assert.ok(typeof flowRecord[field] === 'string', `flow ${index} ${field} must be a string`);
    }
  }
  assert.equal(candidate.item, 'THM-OWV-002');
  assert.equal(candidate.source, 'THM-OWV-001');
  assert.equal(candidate.readOnly, true);
  assert.deepEqual(candidate.routes, [
    '/projects',
    '/projects/:projectId/workspace',
    '/projects/:projectId/work-items/:workItemId',
    '/projects/:projectId/iterations/:iterationId',
    '/projects/:projectId/timeline',
  ]);
  assert.deepEqual(
    candidate.flows.map(({ id }) => id),
    [
      'enter-project',
      'find-attention',
      'understand-blocked-work',
      'see-agent-execution',
      'inspect-evidence',
      'decide-review-acceptance',
      'optional-iteration',
      'trace-timeline-decisions',
    ],
  );

  for (const flow of candidate.flows) {
    for (const field of ['actors', 'states', 'data', 'trace'] as const) {
      assert.ok(flow[field].length > 0, `${flow.id} must define ${field}`);
      assert.ok(
        flow[field].every((value) => typeof value === 'string' && value.trim().length > 0),
        `${flow.id} must define non-empty ${field} values`,
      );
    }
    for (const field of ['translation', 'outcome', 'a11y', 'failure'] as const) {
      assert.ok(flow[field].length > 0, `${flow.id} must define ${field}`);
    }
    assert.ok(flow.steps.length > 0, `${flow.id} must define steps`);
    assert.deepEqual(
      flow.steps.map(({ order }) => order),
      flow.steps.map((_, index) => index + 1),
      `${flow.id} steps must be ordered from one without gaps`,
    );
    for (const step of flow.steps) {
      assert.ok(step.action.trim(), `${flow.id} step ${step.order} must have an action`);
      assert.ok(step.observe.trim(), `${flow.id} step ${step.order} must be observable`);
      assert.ok(candidate.routes.includes(step.route), `${flow.id} step ${step.order} has an invalid route`);
      assert.ok(step.state.trim(), `${flow.id} step ${step.order} must name a state`);
      assert.ok(flow.states.includes(step.state), `${flow.id} step ${step.order} has an undeclared state`);
    }
    assert.deepEqual(
      [...flow.trace].sort(),
      [...requiredPhase1Trace].sort(),
      `${flow.id} must trace every phase-1 vocabulary/state decision`,
    );
  }
};

test('operational workspace manifest covers the approved route model and all required flows', () => {
  validateManifest(manifest);
});

test('manifest preserves phase-1 vocabulary, trust, state, authority, translation, and open-risk traceability', () => {
  for (const trace of requiredPhase1Trace.slice(0, 5)) {
    assert.ok(manifest.phase1Trace.includes(trace), `missing phase-1 trace: ${trace}`);
  }
  for (const decision of ['OWV-D01', 'OWV-D02', 'OWV-D03', 'OWV-D04', 'OWV-D05', 'OWV-D06', 'OWV-D07']) {
    assert.ok(manifest.phase1Trace.includes(decision), `missing open decision: ${decision}`);
  }
  for (const risk of ['OWV-R01', 'OWV-R02', 'OWV-R03']) {
    assert.ok(manifest.phase1Trace.includes(risk), `missing open risk: ${risk}`);
  }
});

test('negative fixtures reject empty, unordered, and incomplete flow contracts', () => {
  const emptySteps = structuredClone(manifest);
  emptySteps.flows[0].steps = [];
  assert.throws(() => validateManifest(emptySteps), /must define steps/);

  const unorderedSteps = structuredClone(manifest);
  unorderedSteps.flows[1].steps[1].order = 1;
  assert.throws(() => validateManifest(unorderedSteps), /must be ordered/);

  const incompleteTrace = structuredClone(manifest);
  incompleteTrace.flows[2].trace = incompleteTrace.flows[2].trace.filter((trace) => trace !== 'OWV-D04');
  assert.throws(() => validateManifest(incompleteTrace), /every phase-1 vocabulary\/state decision/);
});

test('negative fixtures reject invalid routes, malformed states, and empty state paths', () => {
  const invalidRoute = structuredClone(manifest);
  invalidRoute.flows[0].steps[0].route = '/projects/:projectId/unknown';
  assert.throws(() => validateManifest(invalidRoute), /has an invalid route/);

  const malformedState = structuredClone(manifest);
  malformedState.flows[1].steps[0].state = 'not-declared';
  assert.throws(() => validateManifest(malformedState), /has an undeclared state/);

  const emptyStatePath = structuredClone(manifest);
  emptyStatePath.flows[2].states = [];
  assert.throws(() => validateManifest(emptyStatePath), /must define states/);
});

test('negative fixtures reject malformed flow collections and definitions', () => {
  const malformedCollection = structuredClone(manifest) as unknown as Record<string, unknown>;
  malformedCollection.flows = { first: manifest.flows[0] };
  assert.throws(() => validateManifest(malformedCollection as unknown as Manifest), /flows must be an array/);

  const malformedDefinition = structuredClone(manifest);
  malformedDefinition.flows[0] = {
    ...malformedDefinition.flows[0],
    steps: 'not-an-array',
  } as unknown as Flow;
  assert.throws(() => validateManifest(malformedDefinition), /flow 0 steps must be an array/);

  const nonObjectDefinition = structuredClone(manifest) as unknown as Record<string, unknown>;
  nonObjectDefinition.flows = [null, ...manifest.flows.slice(1)];
  assert.throws(() => validateManifest(nonObjectDefinition as unknown as Manifest), /flow 0 must be an object/);
});

test('read-only IA explicitly preserves no-sprint and protected-data boundaries', () => {
  const noSprint = manifest.flows.find(({ id }) => id === 'optional-iteration');
  const evidence = manifest.flows.find(({ id }) => id === 'inspect-evidence');
  const review = manifest.flows.find(({ id }) => id === 'decide-review-acceptance');
  assert.ok(noSprint?.translation.includes('optional context'));
  assert.ok(noSprint?.failure.includes('removes project work'));
  assert.ok(evidence?.failure.includes('no plaintext'));
  assert.ok(review?.a11y.includes('no self-approval'));
});
