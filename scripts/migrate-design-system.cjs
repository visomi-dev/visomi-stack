#!/usr/bin/env node
/* eslint-disable */
// Migrate legacy Tailwind classes that depend on --color-* tokens to
// direct Tailwind palette utilities with opacity, per the Phase 10
// design system cleanup. Run with no arguments from repo root.
//
//   node scripts/migrate-design-system.cjs
//
// The mapping is conservative: light-only by default. Dark variants are
// added when the source block already has dark: classes or when the
// class is a structural container that must flip in dark mode. Manual
// review is still required for high-contrast pairs.
const fs = require('node:fs');
const path = require('node:path');

// Token -> Tailwind palette mapping. Keys are exact class substrings.
const MAP = [
  // background
  ['bg-bg', 'bg-white dark:bg-zinc-950'],
  ['bg-panel', 'bg-zinc-50 dark:bg-zinc-900'],
  ['bg-panel-raised', 'bg-zinc-100 dark:bg-zinc-800'],
  ['bg-surface', 'bg-white dark:bg-zinc-950'],
  ['bg-surface-variant', 'bg-zinc-100 dark:bg-zinc-800'],
  ['bg-surface-dim', 'bg-zinc-50 dark:bg-zinc-900'],
  ['bg-surface-bright', 'bg-white dark:bg-zinc-800'],
  ['bg-surface-container-lowest', 'bg-white dark:bg-zinc-950'],
  ['bg-surface-container-low', 'bg-zinc-50 dark:bg-zinc-900'],
  ['bg-surface-container', 'bg-zinc-100 dark:bg-zinc-800'],
  ['bg-surface-container-high', 'bg-zinc-200 dark:bg-zinc-700'],
  ['bg-surface-container-highest', 'bg-zinc-200 dark:bg-zinc-700'],

  ['bg-primary', 'bg-blue-600 dark:bg-blue-500'],
  ['bg-on-primary', 'bg-white dark:bg-zinc-950'],
  ['bg-primary-container/40', 'bg-blue-600/10 dark:bg-blue-500/20'],
  ['bg-primary-container/20', 'bg-blue-600/5 dark:bg-blue-500/10'],
  ['bg-primary-container', 'bg-blue-600/10 dark:bg-blue-500/20'],
  ['bg-on-primary-container', 'bg-blue-600/10 dark:bg-blue-500/20'],

  ['bg-secondary', 'bg-zinc-500 dark:bg-zinc-400'],
  ['bg-on-secondary', 'bg-white dark:bg-zinc-950'],
  ['bg-secondary-container', 'bg-zinc-100 dark:bg-zinc-800'],
  ['bg-on-secondary-container', 'bg-zinc-100 dark:bg-zinc-800'],

  ['bg-tertiary', 'bg-amber-600 dark:bg-amber-500'],
  ['bg-on-tertiary', 'bg-white dark:bg-zinc-950'],
  ['bg-tertiary-container/40', 'bg-amber-600/10 dark:bg-amber-500/20'],
  ['bg-tertiary-container/20', 'bg-amber-600/5 dark:bg-amber-500/10'],
  ['bg-tertiary-container', 'bg-amber-600/10 dark:bg-amber-500/20'],
  ['bg-on-tertiary-container', 'bg-amber-600/10 dark:bg-amber-500/20'],

  ['bg-success', 'bg-green-600 dark:bg-green-500'],
  ['bg-on-success', 'bg-white dark:bg-green-950'],
  ['bg-success-container/40', 'bg-green-600/10 dark:bg-green-500/20'],
  ['bg-success-container/20', 'bg-green-600/5 dark:bg-green-500/10'],
  ['bg-success-container', 'bg-green-600/10 dark:bg-green-500/20'],
  ['bg-on-success-container', 'bg-green-600/10 dark:bg-green-500/20'],

  ['bg-danger', 'bg-red-600 dark:bg-red-500'],
  ['bg-danger-fg', 'bg-white dark:bg-zinc-950'],
  ['bg-error', 'bg-red-600 dark:bg-red-500'],
  ['bg-on-error', 'bg-white dark:bg-zinc-950'],
  ['bg-error-container/40', 'bg-red-600/10 dark:bg-red-500/20'],
  ['bg-error-container/20', 'bg-red-600/5 dark:bg-red-500/10'],
  ['bg-error-container', 'bg-red-600/10 dark:bg-red-500/20'],
  ['bg-on-error-container', 'bg-red-600/10 dark:bg-red-500/20'],

  ['bg-background', 'bg-white dark:bg-zinc-950'],
  ['bg-on-background', 'bg-zinc-950 dark:bg-zinc-50'],

  ['bg-outline', 'bg-zinc-500 dark:bg-zinc-400'],
  ['bg-outline-variant', 'bg-zinc-950/10 dark:bg-white/10'],

  // text
  ['text-fg', 'text-zinc-950 dark:text-zinc-50'],
  ['text-on-surface', 'text-zinc-950 dark:text-zinc-50'],
  ['text-muted-fg', 'text-zinc-500 dark:text-zinc-400'],
  ['text-on-surface-variant', 'text-zinc-500 dark:text-zinc-400'],
  ['text-on-surface-variant-soft', 'text-zinc-500 dark:text-zinc-400'],

  ['text-primary', 'text-blue-600 dark:text-blue-400'],
  ['text-on-primary', 'text-white dark:text-zinc-950'],
  ['text-on-primary-container', 'text-blue-600 dark:text-blue-400'],
  ['text-primary-container', 'text-blue-600 dark:text-blue-400'],

  ['text-secondary', 'text-zinc-500 dark:text-zinc-400'],
  ['text-on-secondary', 'text-white dark:text-zinc-950'],
  ['text-secondary-container', 'text-zinc-500 dark:text-zinc-400'],
  ['text-on-secondary-container', 'text-zinc-950 dark:text-zinc-50'],

  ['text-tertiary', 'text-amber-600 dark:text-amber-400'],
  ['text-on-tertiary', 'text-white dark:text-zinc-950'],
  ['text-on-tertiary-container', 'text-amber-700 dark:text-amber-400'],
  ['text-tertiary-container', 'text-amber-600 dark:text-amber-400'],

  ['text-success', 'text-green-600 dark:text-green-400'],
  ['text-on-success', 'text-white dark:text-green-950'],
  ['text-on-success-container', 'text-green-800 dark:text-green-400'],
  ['text-success-container', 'text-green-600 dark:text-green-400'],

  ['text-danger', 'text-red-600 dark:text-red-400'],
  ['text-danger-fg', 'text-white dark:text-zinc-950'],
  ['text-error', 'text-red-600 dark:text-red-400'],
  ['text-on-error', 'text-white dark:text-zinc-950'],
  ['text-on-error-container', 'text-red-700 dark:text-red-400'],
  ['text-error-container', 'text-red-600 dark:text-red-400'],

  ['text-on-background', 'text-zinc-950 dark:text-zinc-50'],
  ['text-on-primary', 'text-white dark:text-zinc-950'],

  // border
  ['border-fg', 'border-zinc-950 dark:border-zinc-50'],
  ['border-muted-fg', 'border-zinc-500 dark:border-zinc-400'],
  ['border-bg', 'border-white dark:border-zinc-950'],
  ['border-accent', 'border-blue-600 dark:border-blue-500'],
  ['border-primary', 'border-blue-600 dark:border-blue-500'],
  ['border-danger', 'border-red-600 dark:border-red-500'],
  ['border-outline-variant/60', 'border-zinc-950/10 dark:border-white/10'],
  ['border-outline-variant/40', 'border-zinc-950/10 dark:border-white/10'],
  ['border-outline-variant/25', 'border-zinc-950/10 dark:border-white/10'],
  ['border-outline-variant/20', 'border-zinc-950/10 dark:border-white/10'],
  ['border-outline-variant/10', 'border-zinc-950/5 dark:border-white/5'],
  ['border-outline-variant', 'border-zinc-950/10 dark:border-white/10'],
  ['border-outline/40', 'border-zinc-500/40 dark:border-zinc-400/40'],
  ['border-outline/30', 'border-zinc-500/30 dark:border-zinc-400/30'],
  ['border-outline', 'border-zinc-500 dark:border-zinc-400'],

  // ring
  ['ring-ring', 'ring-blue-500'],
];

// Patterns that already carry a dark: variant: keep them but expand the
// legacy prefix to the Tailwind palette pair (light + dark) so the dark
// side matches the new convention.
function expand(matches, original) {
  return matches
    .map((m) => m)
    .reduce((acc, m) => {
      const escaped = m.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const rx = new RegExp(`(?<!\\S)${escaped}(?!\\S)`);
      return acc.replace(rx, MAP.find(([k]) => k === m)[1]);
    }, original);
}

// Apply longest keys first so /40 doesn't match the unflagged variant.
const SORTED = [...MAP].sort((a, b) => b[0].length - a[0].length);

const ROOTS = ['apps/web/app/src', 'apps/web/site/src', 'libs'];
const EXTS = new Set(['.html', '.ts', '.css']);
const IGNORE = new Set(['.es.xlf']);

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(full, files);
    } else if (EXTS.has(path.extname(entry.name)) && !IGNORE.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
}

const files = [];
for (const root of ROOTS) {
  if (fs.existsSync(root)) walk(root, files);
}

let changed = 0;
let touched = 0;
for (const file of files) {
  const original = fs.readFileSync(file, 'utf8');
  let updated = original;
  for (const [legacy, next] of SORTED) {
    // Match legacy as a whole word inside a Tailwind class string.
    const rx = new RegExp(`(?<![\\w-])${legacy.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(?![\\w-])`, 'g');
    updated = updated.replace(rx, next);
  }
  if (updated !== original) {
    fs.writeFileSync(file, updated, 'utf8');
    changed += 1;
    const lines = original.split('\n').reduce((acc, line, idx) => {
      const updatedLine = updated.split('\n')[idx];
      if (line !== updatedLine) acc.push(idx + 1);
      return acc;
    }, []);
    touched += lines.length;
    console.log(`M ${file} (${lines.length} lines)`);
  }
}

console.log(`\nDone. ${changed} files changed, ${touched} lines touched.`);
