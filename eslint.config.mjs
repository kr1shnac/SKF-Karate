import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'public/**',
      'coverage/**',
      'scratch/**',
      'scripts/scratch/**',
      'check*.ts',
      'check*.tsx',
      'check_*.js',
      'debug-*.ts',
      'disable_branches.ts',
      'run_migration.mjs',
      'scratch*.ts',
      'scratch*.tsx',
      'sync*.ts',
      'test-*.js',
      'test-*.mjs',
      'test-*.ts',
      'test-*.tsx',
      'test-auth.js',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    rules: {
      'no-console': ['warn', { allow: ['error', 'warn', 'info'] }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['scripts/**', 'data/scripts/**'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['tests/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
]

export default eslintConfig
