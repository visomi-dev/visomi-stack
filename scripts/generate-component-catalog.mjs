#!/usr/bin/env node
/* eslint-disable no-console */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.join(__dirname, '..');
const UI_DIR = path.join(ROOT, 'apps/web/app/src/app/shared/ui');
const OUTPUT_JSON = path.join(ROOT, 'docs/design-system/components.json');
const OUTPUT_MD = path.join(ROOT, 'docs/design-system/components.md');

const CATEGORY_LABELS = {
  actions: 'Actions',
  data: 'Data',
  feedback: 'Feedback',
  forms: 'Forms',
  layout: 'Layout',
  media: 'Media',
  overlays: 'Overlays',
  typography: 'Typography',
};

const CATEGORY_ORDER = ['actions', 'data', 'feedback', 'forms', 'layout', 'media', 'overlays', 'typography'];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(full);
    }
  }

  return out;
}

function extractSelector(source) {
  const match = source.match(/selector:\s*['"]([^'"]+)['"]/);

  return match ? match[1] : null;
}

function extractInputs(source) {
  const inputs = [];
  const lines = source.split(/\r?\n/);
  let pendingInput = null;
  let pendingDescription = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const inputMatch = line.match(
      /^\s*readonly\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*input(?:<[^>]+>)?\s*\(\s*['"]?([^,)]*)/,
    );
    const modelMatch = line.match(/^\s*readonly\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*model(?:<[^>]+>)?\s*\(/);

    if (inputMatch) {
      const [, name, defaultValue] = inputMatch;
      inputs.push({ name, required: false, default: defaultValue || null, type: 'input' });
      pendingInput = name;
      pendingDescription = null;
    } else if (modelMatch) {
      const [, name] = modelMatch;
      inputs.push({ name, required: false, default: null, type: 'model' });
      pendingInput = name;
      pendingDescription = null;
    } else if (pendingInput && /^\s*(?:\/\*\*|\/\/|@)/.test(line)) {
      pendingDescription = line
        .replace(/^\s*(?:\/\*\*|\/\/|\* ?)/, '')
        .replace(/\*\//, '')
        .trim();
    } else if (pendingInput && /^\s*readonly\s+[A-Za-z_]/.test(line)) {
      pendingInput = null;
    }
  }

  if (inputs.length > 0) {
    for (const inputEntry of inputs) {
      if (inputEntry.required) {
        continue;
      }
    }
  }

  return inputs;
}

function extractOutputs(source) {
  const outputs = [];
  const matches = source.matchAll(/readonly\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*output(?:<[^>]+>)?\s*\(\s*['"]?([^,)]*)/g);

  for (const match of matches) {
    outputs.push({ name: match[1], type: 'output' });
  }

  return outputs;
}

function isImplementedControlValueAccessor(source) {
  return /implements\s+ControlValueAccessor\b/.test(source);
}

function readComponent(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const baseName = path.basename(filePath, '.ts');
  const selector = extractSelector(source);

  if (!selector || !selector.startsWith('app-')) {
    return null;
  }

  return {
    name: baseName,
    selector,
    inputs: extractInputs(source),
    outputs: extractOutputs(source),
    controlValueAccessor: isImplementedControlValueAccessor(source),
  };
}

function formatSignature(input) {
  return input.required ? `${input.name}` : `${input.name}?`;
}

function renderMarkdown(components) {
  const grouped = new Map();

  for (const component of components) {
    const category = path.relative(UI_DIR, path.dirname(component.filePath)).split(path.sep)[0];
    const list = grouped.get(category) ?? [];
    list.push(component);
    grouped.set(category, list);
  }

  const lines = [];

  lines.push('# Themis UI Components');
  lines.push('');
  lines.push('Components live under `apps/web/app/src/app/shared/ui` and are imported directly from source files.');
  lines.push('This catalog is generated from source by `scripts/generate-component-catalog.mjs`; do not edit by hand.');
  lines.push('');
  lines.push(
    'All component classes are composed from the **Catalyst** token set defined in [`tokens.md`](./tokens.md). Components use Tailwind utilities (`bg-accent`, `text-fg`, `border-border`) and `data-*` state selectors (`data-hover`, `data-current`, `data-invalid`, `data-checked`) instead of dynamic class names.',
  );
  lines.push('');

  const orderedCategories = [...grouped.keys()].sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));

  for (const category of orderedCategories) {
    lines.push(`## ${CATEGORY_LABELS[category] ?? category}`);
    lines.push('');

    const sorted = grouped.get(category).sort((a, b) => a.name.localeCompare(b.name));

    for (const component of sorted) {
      if (!component.selector) {
        continue;
      }

      lines.push(`### \`<${component.selector}>\``);
      lines.push('');
      lines.push(`- Source: \`${path.relative(ROOT, component.filePath)}\``);

      if (component.templatePath) {
        lines.push(`- Template: \`${path.relative(ROOT, component.templatePath)}\``);
      }
      if (component.stylePath) {
        lines.push(`- Styles: \`${path.relative(ROOT, component.stylePath)}\``);
      }
      if (component.controlValueAccessor) {
        lines.push('- Implements `ControlValueAccessor` (compatible with Signal Forms via the CVA interop).');
      }

      if (component.inputs.length > 0) {
        lines.push('- Inputs:');
        for (const input of component.inputs) {
          lines.push(`  - \`${formatSignature(input)}\``);
        }
      }

      if (component.outputs.length > 0) {
        lines.push('- Outputs:');
        for (const output of component.outputs) {
          lines.push(`  - \`${output.name}\``);
        }
      }

      lines.push('');
    }
  }

  return lines.join('\n');
}

function buildCatalog() {
  const files = walk(UI_DIR);
  const components = files
    .map((filePath) => {
      const base = readComponent(filePath);

      if (!base) {
        return null;
      }

      const dir = path.dirname(filePath);
      const htmlPath = path.join(dir, `${path.basename(filePath, '.ts')}.html`);
      const cssPath = path.join(dir, `${path.basename(filePath, '.ts')}.css`);
      const specPath = path.join(dir, `${path.basename(filePath, '.ts')}.spec.ts`);

      return {
        ...base,
        filePath,
        templatePath: fs.existsSync(htmlPath) ? htmlPath : null,
        stylePath: fs.existsSync(cssPath) ? cssPath : null,
        hasSpec: fs.existsSync(specPath),
      };
    })
    .filter((component) => component !== null);

  fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify({ components }, null, 2));
  fs.writeFileSync(OUTPUT_MD, renderMarkdown(components));

  console.log(`[catalog] wrote ${components.length} components to ${path.relative(ROOT, OUTPUT_JSON)}`);
}

buildCatalog();
