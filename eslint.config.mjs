// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nxPlugin from '@nx/eslint-plugin';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.nx/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { '@nx': nxPlugin },
    rules: {
      // The whole point of this repo is capturing other people's data safely;
      // an implicit `any` in a normalizer is how a Blob ends up JSON.stringify'd.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],

      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            {
              sourceTag: 'scope:schema',
              onlyDependOnLibsWithTags: ['scope:schema'],
            },
            {
              sourceTag: 'scope:recorder',
              onlyDependOnLibsWithTags: ['scope:schema'],
            },
            // The player must never import the recorder: it would pull capture
            // code (fetch/XHR patches) into a tool that only ever reads archives.
            {
              sourceTag: 'scope:player',
              onlyDependOnLibsWithTags: ['scope:schema'],
            },
            {
              sourceTag: 'scope:demo',
              onlyDependOnLibsWithTags: ['scope:schema', 'scope:recorder'],
            },
            // PLAN.md 4.9 guard #4. Matches nothing today; live the moment a
            // real product app is added to this workspace with this tag.
            {
              sourceTag: 'scope:product',
              onlyDependOnLibsWithTags: ['scope:schema'],
            },
          ],
        },
      ],
    },
  },
);
