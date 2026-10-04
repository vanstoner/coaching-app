// #99 AC5: the linter. A modest base (eslint + typescript-eslint recommended)
// plus the two project rules that encode invariants lint can express:
//
//   engine purity  src/engine/** imports no React, React Native or Expo.
//                  CLAUDE.md: "The match engine stays pure TypeScript".
//   one clock      App.tsx and src/screens/** never read the device clock or
//                  build an engine without the app clock (#95 AC3). Mirrors
//                  src/app/oneClock.test.ts, which stays: it is the backstop
//                  for anyone running tests without lint.
//
// The base is tuned so the code as it stands passes. Turning a rule up is a
// separate, deliberate change, not a side effect of adding the linter.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

const ENGINE_PURITY = {
  patterns: [
    {
      group: ['react', 'react/*', 'react-native', 'react-native/*', 'expo', 'expo-*', 'expo/*', '@expo/*'],
      message: 'The match engine stays pure TypeScript: no React, React Native or Expo imports in src/engine (CLAUDE.md).',
    },
  ],
};

const ONE_CLOCK_MESSAGE =
  'Read time from the one app clock, never the device clock (#95 AC3, src/app/oneClock.test.ts).';

const ONE_CLOCK = [
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: `Date.now(): ${ONE_CLOCK_MESSAGE}`,
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message: `new Date() with no argument: ${ONE_CLOCK_MESSAGE}`,
  },
  {
    selector: "NewExpression[callee.name='MatchEngine'][arguments.length=0]",
    message: `new MatchEngine() without the app clock: ${ONE_CLOCK_MESSAGE}`,
  },
];

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'dist/',
      'coverage/',
      'android/',
      'ios/',
      '.expo/',
      '.expo-bundle-check/',
      '.claude/',
      'docs/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // The code already carries `eslint-disable react-hooks/exhaustive-deps`
      // comments; this makes them mean something.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // A warning, not an error: three dead names in product code today
      // (MatchEngine.ts, PitchView.tsx, PlanScreen.tsx) are the Engineer's to
      // remove, not the linter's to block a release over. `_`-prefixed names
      // are deliberately unused.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Tests poke at untyped shapes on purpose (config objects, corrupted files).
    files: ['**/*.test.{ts,tsx}'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/engine/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', ENGINE_PURITY] },
  },
  {
    files: ['App.tsx', 'src/screens/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': ['error', ...ONE_CLOCK] },
  }
);
