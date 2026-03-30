import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'vitest.config.ts', 'eslint.config.js'],
  },
);
