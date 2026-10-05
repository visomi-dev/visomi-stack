import { configs as nxConfigs } from '@nx/eslint-plugin';

import baseConfig from '../../../eslint.config.mjs';
import angularI18nRule from '../../../tools/eslint/angular-i18n-rule.mjs';

export default [
  ...nxConfigs['flat/angular'],
  ...nxConfigs['flat/angular-template'],
  ...baseConfig,
  {
    files: ['**/*.ts'],
    ignores: ['**/*.spec.ts'],
    plugins: {
      themis: {
        rules: {
          'angular-i18n': angularI18nRule,
        },
      },
    },
    rules: {
      'themis/angular-i18n': 'error',
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    rules: {
      '@angular-eslint/template/i18n': [
        'error',
        {
          checkAttributes: true,
          checkId: true,
          checkText: true,
          ignoreAttributes: [
            'autocomplete',
            'aria-controls',
            'ariaDescribedBy',
            'aria-live',
            'aria-labelledby',
            'ariaLabelledBy',
            'animate.enter',
            'animate.leave',
            'charset',
            'class',
            'color',
            'colspan',
            'content',
            'controlId',
            'd',
            'data-od-id',
            'data-slot',
            'dir',
            'fill',
            'for',
            'formArrayName',
            'formControlName',
            'formGroupName',
            'height',
            'href',
            'id',
            'idPrefix',
            'inputmode',
            'initials',
            'lang',
            'list',
            'layout',
            'name',
            'ngClass',
            'ngProjectAs',
            'optionValue',
            'padding',
            'role',
            'routerLink',
            'routerLinkActive',
            'queryParamsHandling',
            'rel',
            'size',
            'src',
            'stroke',
            'stroke-linecap',
            'stroke-linejoin',
            'stroke-width',
            'style',
            'svgIcon',
            'tabindex',
            'target',
            'tone',
            'type',
            'value',
            'variant',
            'viewBox',
            'width',
            'xmlns',
          ],
        },
      ],
    },
  },
];
