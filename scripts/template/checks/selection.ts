import { basename, resolve } from 'node:path';

export type Target = {
  executor?: string;
  options?: { command?: string; cwd?: string };
};
export type Project = { name: string; root: string; targets: Record<string, Target> };
export type Check = { project: string; target: string; args: string[]; reason: string };

export const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
export const isCode = (file: string): boolean => /\.[cm]?[jt]sx?$/.test(file);
export const isTest = (file: string): boolean => /\.(spec|test)\.[cm]?[jt]sx?$/.test(file);
const inside = (file: string, root: string): boolean => file.startsWith(`${root}/`);
const lintConfig = (file: string): boolean =>
  /(^|\/)(eslint(\.base)?\.config\.[^/]+|\.eslintrc[^/]*)$/.test(file) ||
  file.startsWith('tools/eslint-rules/') ||
  file.startsWith('tools/eslint/');
const testConfig = (file: string): boolean =>
  /(^|\/)(package\.json|pnpm-lock\.yaml|nx\.json|project\.json|tsconfig[^/]*|.*config\.[cm]?[jt]s|.*preset\.[cm]?[jt]s|.*test-setup\.[cm]?[jt]s)$/.test(
    file,
  );

export const requiresFullLint = (file: string): boolean =>
  lintConfig(file) || /(^|\/)(package\.json|pnpm-lock\.yaml|nx\.json|project\.json|tsconfig[^/]*)$/.test(file);

export function selectCheck(project: Project, target: string, files: string[], missing: string[] = []): Check | null {
  const definition = project.targets[target];

  if (!definition) return null;
  const command = definition.options?.command ?? '';
  const result: Check = { project: project.name, target, args: [], reason: 'affected project' };
  const externalSource = files.some((file) => isCode(file) && !isTest(file) && !inside(file, project.root));
  const full =
    externalSource ||
    files.some(testConfig) ||
    missing.length > 0 ||
    files.some(
      (file) =>
        !isCode(file) &&
        !file.includes('/__snapshots__/') &&
        !/\.snap$/.test(file) &&
        !(/\.(html|css|scss)$/.test(file) && files.includes(file.replace(/\.(html|css|scss)$/, '.ts'))),
    );

  if (target === 'lint') {
    if (files.some(requiresFullLint)) {
      const rootRules = files.filter((file) => lintConfig(file) && isCode(file) && !missing.includes(file));

      if (project.name === 'template' && command === 'eslint .' && rootRules.length) {
        result.args = [
          `--command=eslint . ${rootRules.map((file) => quote(resolve(file))).join(' ')} --max-warnings 0`,
        ];
      }

      return { ...result, reason: 'lint configuration or dependencies changed' };
    }
    const owned = files.filter((file) => {
      const belongs =
        inside(file, project.root) ||
        (project.name === 'template' &&
          (!file.includes('/') || file.startsWith('scripts/') || file.startsWith('tools/')));

      return belongs && !missing.includes(file) && (isCode(file) || /\.(html|astro)$/.test(file));
    });

    if (!owned.length) return null;
    if (definition.executor === '@nx/eslint:lint') {
      result.args = [`--lintFilePatterns=${owned.join(',')}`];
    } else if (/^eslint \.$/.test(command)) {
      result.args = [`--command=eslint ${owned.map((file) => quote(resolve(file))).join(' ')} --max-warnings 0`];
    } else return result;

    return { ...result, reason: 'changed lintable files only' };
  }
  if (target === 'e2e') {
    // URL-driven browser suites have no import dependency on production runtime source.
    const testInputsOnly = files.every(
      (file) => inside(file, project.root) && (isCode(file) || file.includes('/__snapshots__/')),
    );

    if (!full && testInputsOnly && definition.executor === '@nx/playwright:playwright') {
      const specsOnly = files.every((file) => isTest(file) || file.includes('/__snapshots__/'));
      const specs = files.filter(isTest);

      result.args =
        specsOnly && specs.length
          ? [`--testFiles=${specs.map((file) => resolve(file)).join(',')}`]
          : ['--onlyChanged', '--passWithNoTests'];
      result.reason = specsOnly ? 'changed browser specs' : 'browser tests related to changed fixtures';
    }

    return result;
  }
  if (target === 'test' || target === 'vite:test') {
    const related = files.filter(isCode).map((file) => resolve(file));

    if (!full && related.length && /(^|[ /])jest(\.js)?( |$)/.test(command)) {
      result.args = [`--args=--findRelatedTests ${related.map(quote).join(' ')} --passWithNoTests --runInBand`];
      result.reason = 'Jest tests related to changed sources';
    } else if (!full && related.length && /^vitest$/.test(command)) {
      result.args = [`--args=related ${related.map(quote).join(' ')} --run --passWithNoTests`];
      result.reason = 'Vitest tests related to changed sources';
    } else if (/^vitest$/.test(command)) {
      result.args = ['--run'];
    } else if (
      !full &&
      project.name === 'template' &&
      files.every(isTest) &&
      command.includes('pnpm exec esbuild ') &&
      command.includes('node --test')
    ) {
      const owned = files.filter((file) => inside(file, project.root));

      if (owned.length) {
        const outputs = owned.map((file) =>
          quote(resolve('dist/template/tests', basename(file).replace(/\.[cm]?[jt]sx?$/, '.cjs'))),
        );

        result.args = [
          `--command=pnpm exec esbuild ${owned.map(quote).join(' ')} --bundle --platform=node --format=cjs --packages=external --outdir=dist/template/tests --out-extension:.js=.cjs && node --test ${outputs.join(' ')}`,
        ];
        result.reason = 'changed native Node test files';
      }
    }
    if (externalSource) result.reason = 'complete consumer suite for a changed dependency';

    return result;
  }

  return result;
}

export function companion(file: string): string | null {
  if (/\.(html|css|scss)$/.test(file)) return file.replace(/\.(html|css|scss)$/, '.ts');
  if (file.includes('/__snapshots__/')) {
    const [root, snapshot] = file.split('/__snapshots__/');
    const parts = snapshot.split('/').slice(1);
    const spec = parts.findIndex((part) => isTest(part));

    if (spec >= 0) return `${root}/${parts.slice(0, spec + 1).join('/')}`;
  }
  if (basename(file).endsWith('.snap')) return file.replace('/__snapshots__/', '/').replace(/\.snap$/, '');

  return null;
}
