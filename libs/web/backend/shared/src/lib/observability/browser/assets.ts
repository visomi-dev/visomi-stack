import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type BrowserAssets = Map<string, { paths: string[]; lines: number[] }>;

// Read only the executable's own immutable build output, never a client-selected path.
export async function browserAssets(directory: string, prefix = ''): Promise<BrowserAssets> {
  const assets: BrowserAssets = new Map();

  async function visit(relative: string): Promise<void> {
    const entries = await readdir(join(directory, relative), { withFileTypes: true });

    for (const entry of entries) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && /\.(?:m?js)$/.test(entry.name)) {
        const bytes = await readFile(join(directory, path));
        const id = createHash('sha256').update(bytes).digest('hex');

        const existing = assets.get(id);

        if (existing) {
          existing.paths.push(`${prefix}/${path}`);
        } else {
          assets.set(id, {
            paths: [`${prefix}/${path}`],
            lines: bytes
              .toString('utf8')
              .split('\n')
              .map((line) => line.length),
          });
        }
      }
    }
  }

  await visit('');

  return assets;
}
