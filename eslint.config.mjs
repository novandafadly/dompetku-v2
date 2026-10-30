import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import nextVitals from 'eslint-config-next/core-web-vitals';
import boundaries from 'eslint-plugin-boundaries';
import betterTailwind from 'eslint-plugin-better-tailwindcss';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const root = path.dirname(fileURLToPath(import.meta.url));

const dateMsg =
  'Format tanggal hanya lewat packages/domain/src/date.ts (zona browser tidak boleh dipakai).';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/next-env.d.ts',
      'docs/**',
      '.superpowers/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        projectService: { allowDefaultProject: ['*.mjs', '*.config.ts', 'apps/web/*.config.ts'] },
        tsconfigRootDir: root,
      },
    },
  },
  ...nextVitals,
  { settings: { next: { rootDir: 'apps/web' } } },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'ui', pattern: 'apps/web/src/components/ui/**' },
        {
          type: 'feature',
          pattern: 'apps/web/src/features/*',
          capture: ['feature'],
          mode: 'folder',
        },
      ],
      'boundaries/ignore': ['**/*.test.*'],
    },
    rules: {
      'boundaries/element-types': [
        'error',
        {
          default: 'allow',
          rules: [
            {
              from: 'feature',
              disallow: [['feature', { feature: '!{{from.feature}}' }]],
              message: 'features/* tidak boleh mengimpor internal fitur lain; pakai index.ts.',
            },
          ],
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'date-fns', message: 'Pakai packages/domain/src/date.ts.' },
            { name: 'moment', message: 'Pakai packages/domain/src/date.ts.' },
            {
              name: 'radix-ui',
              message: 'radix-ui hanya boleh diimpor dari apps/web/src/components/ui.',
            },
          ],
          patterns: [
            { group: ['date-fns/*', 'moment/*'], message: 'Pakai packages/domain/src/date.ts.' },
            { group: ['@radix-ui/*'], message: 'Pakai paket radix-ui dari components/ui saja.' },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Intl', property: 'DateTimeFormat', message: dateMsg },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "NewExpression[callee.object.name='Intl'][callee.property.name='DateTimeFormat']",
          message: dateMsg,
        },
        {
          selector: 'CallExpression[callee.property.name=/^toLocale(Date|Time)?String$/]',
          message: dateMsg,
        },
      ],
    },
  },
  {
    files: ['apps/web/src/components/ui/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'date-fns', message: 'Pakai packages/domain/src/date.ts.' },
            { name: 'moment', message: 'Pakai packages/domain/src/date.ts.' },
          ],
          patterns: [
            { group: ['date-fns/*', 'moment/*'], message: 'Pakai packages/domain/src/date.ts.' },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/domain/src/date.ts'],
    rules: { 'no-restricted-properties': 'off', 'no-restricted-syntax': 'off' },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    // Plugin jsx-a11y sudah didaftarkan oleh eslint-config-next; di sini hanya aturannya.
    rules: jsxA11y.flatConfigs.recommended.rules,
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'better-tailwindcss': betterTailwind },
    settings: {
      'better-tailwindcss': { entryPoint: path.join(root, 'apps/web/src/styles/globals.css') },
    },
    rules: {
      'better-tailwindcss/no-unknown-classes': 'error',
      'better-tailwindcss/no-conflicting-classes': 'error',
      'better-tailwindcss/no-restricted-classes': [
        'error',
        {
          restrict: [
            {
              pattern: '^.*-\\[.+\\]$',
              message: 'Nilai arbitrer dilarang; pakai token dari @theme.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.mjs', '**/*.config.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
);
