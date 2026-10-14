import { relative } from 'node:path';

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function format(files) {
  const paths = files.map((file) => relative(process.cwd(), file)).join(',');

  return `pnpm exec nx format:write --files=${quote(paths)} --sort-root-tsconfig-paths=false`;
}

export default {
  '*': (files) => [
    `node --experimental-strip-types scripts/template/checks/affected.ts lint ${files.map(quote).join(' ')}`,
    format(files),
  ],
};
