import tsParser from '@typescript-eslint/parser'

export default [
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'release/**',
      'node_modules/**',
      'native-module/**',
      'resources/**',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}', 'electron/**/*.{ts,tsx,js}', 'test/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {},
  },
]
