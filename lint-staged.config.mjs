import { relative } from 'node:path';

function format(files) {
  const paths = files.map((file) => relative(process.cwd(), file)).join(',');

  return `pnpm exec nx format:write --files=${JSON.stringify(paths)} --sort-root-tsconfig-paths=false`;
}

export default {
  '*': (files) => [
    `node --import tsx scripts/template/checks/affected.ts lint ${files.map((file) => JSON.stringify(file)).join(' ')}`,
    format(files),
  ],
};
