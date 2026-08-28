// Applies the chore/forms-i18n cleanup (NG8113 unused-import removal +
// merge-i18n.cjs script) on top of the current branch. The chore's
// messages.xlf is intentionally NOT applied (it is older than main's
// current messages.xlf; we keep main's version).
const fs = require('node:fs');

const routeFiles = [
  'apps/web/app/src/app/auth/sign-in/sign-in.ts',
  'apps/web/app/src/app/auth/sign-up/sign-up.ts',
  'apps/web/app/src/app/auth/forgotten-password/forgotten-password.ts',
  'apps/web/app/src/app/auth/reset-password/reset-password.ts',
  'apps/web/app/src/app/auth/verification-code-form/verification-code-form.ts',
  'apps/web/app/src/app/activation/activation.ts',
  'apps/web/app/src/app/projects/project-new/project-new.ts',
];

// Remove 'FormRoot' and ', ' patterns from @angular/forms/signals imports
// and from the @Component({ imports: [...] }) arrays.
for (const p of routeFiles) {
  let s = fs.readFileSync(p, 'utf8');
  // Remove ', FormRoot' / 'FormRoot, ' / ' FormRoot' from the TS import line
  s = s
    .replace(/, FormRoot(,?)/g, '$1')
    .replace(/FormRoot, /g, '')
    .replace(/ FormRoot/g, '');
  // Remove the 'FormRoot,' line from the @Component imports: array
  // (multi-line: line with just "    FormRoot,")
  s = s.replace(/^    FormRoot,\n/m, '');
  fs.writeFileSync(p, s);
  console.log('cleaned', p);
}

// sign-up: also remove Description
{
  const p = 'apps/web/app/src/app/auth/sign-up/sign-up.ts';
  let s = fs.readFileSync(p, 'utf8');
  s = s
    .replace(/, Description(,?)/g, '$1')
    .replace(/Description, /g, '')
    .replace(/ Description/g, '');
  s = s.replace(/^    Description,\n/m, '');
  fs.writeFileSync(p, s);
  console.log('cleaned Description in', p);
}

// logo: remove Icon import
{
  const p = 'apps/web/app/src/app/shared/layout/logo/logo.ts';
  let s = fs.readFileSync(p, 'utf8');
  s = s.replace(/^import \{ Icon \} from '\.\.\/\.\.\/\.\.\/ui\/media\/icon\/icon';\n/m, '');
  fs.writeFileSync(p, s);
  console.log('cleaned Icon in', p);
}
