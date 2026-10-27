import tsPlugin from '@typescript-eslint/eslint-plugin'

const files = ['src/**/*.{ts,tsx}', 'electron/**/*.{ts,tsx,js}', 'test/**/*.{ts,tsx}']

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
  // The plugin's own recommended set: it brings the TypeScript parser, so the files parse and are also checked.
  ...tsPlugin.configs['flat/recommended'].map((config) => ({ ...config, files })),
  // Rules the code base already breaks (1268 findings on 2026-10-26: no-explicit-any 878, no-unused-vars 171,
  // no-require-imports 106, ban-ts-comment 99, and a handful of others). They warn instead of fail, and the
  // `lint` script caps the number of warnings so it can only go down. Every other recommended rule is an error.
  {
    files,
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      '@typescript-eslint/no-this-alias': 'warn',
      '@typescript-eslint/prefer-as-const': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      'prefer-const': 'warn',
      'prefer-rest-params': 'warn',
    },
  },
]
