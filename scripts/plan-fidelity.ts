export const validationCategories = [
  'unit',
  'api',
  'app-e2e',
  'gateway-e2e',
  'site-e2e',
  'visual',
  'security',
  'build',
] as const;

export type ValidationCategory = (typeof validationCategories)[number];

export type PlanPhase = { id: string; title: string; richSteps?: string[] };
export type PhaseWorkItem = {
  id: string;
  phaseIds: string[];
  status: string;
  acceptanceCriteria: string[];
  scopeIn: string[];
};
export type TraceabilityRow = {
  phaseId: string;
  phaseTitle: string;
  itemIds: string[];
  statuses: string[];
  gaps: string[];
};

export type ValidationEvidence = {
  summary: string;
  value: string;
};

const validationRowPattern = /^\[([^\]]+)\]\[(required|not-applicable)\]\s+(.+)$/;
const evidenceCategoryPattern = /^\[([^\]]+)\]/;

const isValidationCategory = (value: string): value is ValidationCategory =>
  (validationCategories as readonly string[]).includes(value);

export const tracePlanPhases = (phases: PlanPhase[], items: PhaseWorkItem[]): TraceabilityRow[] =>
  phases.map((phase) => {
    const matches = items.filter((item) => item.phaseIds.includes(phase.id));
    const representedText = matches
      .flatMap((item) => [...item.acceptanceCriteria, ...item.scopeIn])
      .join(' ')
      .toLowerCase();
    const gaps = matches.length === 0 ? ['No work item or explicit sub-scope maps to this phase.'] : [];

    for (const richStep of phase.richSteps ?? []) {
      if (!representedText.includes(richStep.toLowerCase())) gaps.push(`Rich plan step is not observable: ${richStep}`);
    }

    return {
      phaseId: phase.id,
      phaseTitle: phase.title,
      itemIds: matches.map((item) => item.id),
      statuses: matches.map((item) => item.status),
      gaps,
    };
  });

export const missingValidationCategories = (strategy: string[]): ValidationCategory[] => {
  const present = new Set<ValidationCategory>();

  for (const line of strategy) {
    const match = /^\[([^\]]+)\]\[(required|not-applicable)\]/.exec(line);

    if (match && (validationCategories as readonly string[]).includes(match[1]))
      present.add(match[1] as ValidationCategory);
  }

  return validationCategories.filter((category) => !present.has(category));
};

export const invalidValidationRows = (strategy: string[]): string[] => {
  const seen = new Set<string>();
  const errors: string[] = [];

  for (const line of strategy) {
    const match = validationRowPattern.exec(line);

    if (!match || !isValidationCategory(match[1])) {
      errors.push(`Malformed validation row: ${line}`);
      continue;
    }

    const category = match[1];

    if (seen.has(category)) errors.push(`Duplicate validation row: ${category}`);
    seen.add(category);

    if (match[2] === 'not-applicable' && match[3].trim().length === 0)
      errors.push(`Not-applicable validation row requires a reason: ${category}`);
  }

  return errors;
};

export const invalidNotApplicableReasons = (strategy: string[]): string[] =>
  strategy.filter((line) => {
    return /^\[[^\]]+\]\[not-applicable\]\s*$/.test(line);
  });

export const validationMatrixErrors = (strategy: string[]): string[] => [
  ...invalidValidationRows(strategy),
  ...missingValidationCategories(strategy).map((category) => `Missing validation row: ${category}`),
];

export const traceabilityErrors = (rows: TraceabilityRow[]): string[] =>
  rows.flatMap((row) => row.gaps.map((gap) => `${row.phaseId}: ${gap}`));

export const evidenceMatrixErrors = (
  requiredCategories: ValidationCategory[],
  evidence: ValidationEvidence[],
): string[] => {
  const counts = new Map<string, number>();
  const errors: string[] = [];

  for (const entry of evidence) {
    const category = evidenceCategoryPattern.exec(entry.summary)?.[1];

    if (!category || !isValidationCategory(category)) {
      errors.push(`Evidence has no valid category: ${entry.summary}`);
      continue;
    }
    counts.set(category, (counts.get(category) ?? 0) + 1);
    if (
      !/^Command:\s*\S+/m.test(entry.value) ||
      !/^Result:\s*(passed|failed|blocked|not-applicable)\b/im.test(entry.value)
    )
      errors.push(`Evidence must include an exact command and result: ${category}`);
  }

  for (const category of requiredCategories) {
    const count = counts.get(category) ?? 0;

    if (count !== 1) errors.push(`Expected one evidence entry for ${category}, found ${count}`);
  }

  return errors;
};

export const scopeChangeAction = (
  approved: boolean,
  affectsExistingScope: boolean,
): 'update-and-rework' | 'create-new-item' | 'no-mutation' => {
  if (!approved) return 'no-mutation';

  return affectsExistingScope ? 'update-and-rework' : 'create-new-item';
};
