import { RuleTester } from 'eslint';

import rule from './angular-i18n-rule.mjs';

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
});

ruleTester.run('angular-i18n', rule, {
  valid: [
    'const options = { message: $localize`:@@emailRequired:Enter your email address.` };',
    "const options = { label: dynamicLabel, size: 'md', route: '/settings' };",
    "google.accounts.id.renderButton(element, { text: 'continue_with' });",
    'errorMessage.set($localize`:@@saveFailed:We could not save your changes.`);',
    'errorMessage.set(error.message);',
  ],
  invalid: [
    {
      code: "const options = { message: 'Enter your email address.' };",
      errors: [{ messageId: 'useLocalize' }],
    },
    {
      code: 'const options = { message: $localize`Enter your email address.` };',
      errors: [{ messageId: 'useLocalize' }],
    },
    {
      code: "const options = { 'ariaLabel': `Close dialog` };",
      errors: [{ messageId: 'useLocalize' }],
    },
    {
      code: "notice.set('Changes saved.');",
      errors: [{ messageId: 'useLocalize' }],
    },
  ],
});
