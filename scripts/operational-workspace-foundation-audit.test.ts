import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const auditPath = 'docs/architecture/system/operational-workspace-foundation-audit.md';
const audit = readFileSync(auditPath, 'utf8');
const escapeRegex = (value: string): string => value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

const vocabulary = [
  'Project',
  'Epic / outcome',
  'Work item',
  'Run',
  'Evidence',
  'Review',
  'Activity / event',
  'Attention',
  'Blocked',
  'Validation',
  'Iteration / sprint (optional)',
];

const visualStates = [
  'Loading',
  'Empty',
  'Attention',
  'Blocked',
  'In progress',
  'Locked',
  'Unavailable',
  'Stale',
  'Error',
  'Validated',
  'Review pending',
  'Accepted',
  'Rejected',
  'Rework',
];

const classifiedObjects = [
  'Project identity',
  'Project context',
  'Epic/outcome identity',
  'Work-item identity',
  'Work-item intent',
  'Run identity',
  'Run command output',
  'Evidence kind',
  'Evidence report',
  'Review identity',
  'Review feedback',
  'Activity/event envelope',
  'Activity/event payload',
  'State fields and visibility conditions',
  'Event fields that disclose secrets',
];

const translatedEvents = [
  'work_item.in_progress',
  'work_item.blocked',
  'run.completed',
  'validation.failed',
  'validation.blocked',
  'validation.passed',
  'evidence.added',
  'review.requested',
  'review.accepted',
  'review.rejected',
  'work_item.rework',
  'read.locked',
  'read.unavailable',
  'read.stale',
  'activity.recorded',
];

describe('operational workspace foundation audit', () => {
  it('covers the canonical vocabulary and trust-boundary requirements', () => {
    for (const term of vocabulary) {
      const escaped = escapeRegex(term);
      assert.match(audit, new RegExp(term.startsWith('Iteration') ? escaped : `\\*\\*${escaped}\\*\\*`));
    }
    assert.match(audit, /prohibited conflations|Must not be conflated with/);
    assert.match(audit, /local agent|themis-agent/);
    assert.match(audit, /Public or operational|Protected/);
    for (const object of classifiedObjects) assert.match(audit, new RegExp(escapeRegex(object)));
  });

  it('covers every required visual state with non-color semantics', () => {
    assert.match(audit, /Color is supportive, never the sole encoding/);
    for (const state of visualStates) assert.match(audit, new RegExp(`\\|\\s*${state}\\s*\\|`));
    assert.match(audit, /Light and dark modes/);
  });

  it('names data and token authorities without hiding the known conflict', () => {
    for (const source of [
      'docs/design/design-system-reference.md',
      'docs/design-system/tokens.md',
      'styles.base.css',
      'apps/web/site/src/styles/global.css',
      'themis-agent',
      'read-model',
    ])
      assert.match(audit, new RegExp(escapeRegex(source)));
    assert.match(audit, /Known authority conflict/);
  });

  it('provides causal, actor, temporal, action, and authority translation fields', () => {
    for (const event of translatedEvents) assert.match(audit, new RegExp('\\|\\s*`' + event + '`\\s*\\|'));
    for (const column of ['Causal context', 'Actor', 'Time', 'Next useful action', 'Confidence / authority caveat']) {
      assert.match(audit, new RegExp(`\\|\\s*${column}\\s*\\|`));
    }
  });

  it('records unresolved decisions and explicit human review gates', () => {
    assert.match(audit, /Open decisions, risks, and review gates/);
    assert.match(audit, /These are intentionally open/);
    assert.match(audit, /Required review gates/);
    for (const gate of [
      'Vocabulary gate',
      'Trust gate',
      'Token/state gate',
      'Comprehension gate',
      'Read-boundary gate',
    ]) {
      assert.match(audit, new RegExp(`\\*\\*${gate}:?\\*\\*`));
    }
  });
});
