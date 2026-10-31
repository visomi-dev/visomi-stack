import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { SourceMap } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export async function resolveBrowserError(directory, asset, line, column) {
  if (
    !/^[a-f0-9]{64}$/.test(asset) ||
    !Number.isSafeInteger(line) ||
    !Number.isSafeInteger(column) ||
    line < 1 ||
    column < 1
  ) {
    throw new Error('browser_location_invalid');
  }

  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      const match = await resolveBrowserError(path, asset, line, column);

      if (match) {
        return match;
      }
    } else if (entry.isFile() && /\.(?:m?js)$/.test(entry.name)) {
      const content = await readFile(path);

      if (createHash('sha256').update(content).digest('hex') !== asset) {
        continue;
      }

      const source = await readFile(path + '.map', 'utf8');
      const map = new SourceMap(JSON.parse(source));
      const position = map.findEntry(line - 1, column - 1);

      return typeof position.originalSource === 'string'
        ? {
            source: position.originalSource,
            line: position.originalLine + 1,
            column: position.originalColumn + 1,
          }
        : undefined;
    }
  }

  return undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        directory: { type: 'string' },
        asset: { type: 'string' },
        line: { type: 'string' },
        column: { type: 'string' },
      },
    });
    const result = await resolveBrowserError(
      values.directory,
      values.asset,
      Number(values.line),
      Number(values.column),
    );

    if (!result) {
      throw new Error('browser_location_unmapped');
    }

    console.log(JSON.stringify(result));
  } catch {
    console.error('browser_error_unresolved');
    process.exitCode = 1;
  }
}
