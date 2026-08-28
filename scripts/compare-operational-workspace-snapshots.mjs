import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const [left, right] = process.argv.slice(2);
if (!left || !right) throw new Error('Usage: compare-operational-workspace-snapshots.mjs <left> <right>');

const files = await readdir(left);
const differences = [];
for (const file of files) {
  const [expected, actual] = await Promise.all([readFile(join(left, file)), readFile(join(right, file))]);
  if (!expected.equals(actual)) differences.push(file);
}
if (differences.length > 0) throw new Error(`Snapshot differences: ${differences.join(', ')}`);
console.log(`No snapshot differences across ${files.length} files.`);
