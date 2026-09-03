// eslint.config.js — ESLint v9 flat config for the MnemoReader cartridge.
//
// The same rules as the Pheme cartridge and the host, for the same reason: a
// cartridge is a public artifact, read by people deciding whether to trust
// Mnemosyne OS with their memory. Every rule below caught a real bug in this
// codebase rather than expressing a style opinion — and the reader has its own
// list of scars to show for them:
//
//  • no-floating-promises  — this player fires synthesis, warm-up and probes
//                            without awaiting them; an unhandled rejection in
//                            one is a reading that stops with nothing said
//  • no-empty              — a silent catch is the project's cardinal sin
//                            (CLAUDE rule 7), and a swallowed TTS error is
//                            exactly how "the engine is not picked up" looked
//  • exhaustive-deps       — the Reader keeps its callbacks in a ref precisely
//                            because a stale closure once advanced dead state
//  • no-explicit-any       — the bridge payloads ARE the contract with the host
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'eslint.config.js', 'vite.config.ts'],
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        // Tests are excluded from tsconfig.json on purpose (the app build must
        // not depend on the test runner being installed), so the project
        // service cannot type them — allowDefaultProject lets it lint them
        // anyway instead of reporting a parsing error on the whole file.
        projectService: {
          allowDefaultProject: ['src/*/*.test.ts', 'src/*/*/*.test.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // ── Correctness ────────────────────────────────────────────────────────
      '@typescript-eslint/no-floating-promises': 'error',
      // An async JSX handler is idiomatic React and safe here: each one owns its
      // try/catch and reports into a toast. The dangerous case — a promise
      // nobody holds, in ordinary code — stays caught by no-floating-promises.
      '@typescript-eslint/no-misused-promises': ['error', {
        checksVoidReturn: { attributes: false },
      }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // A catch that does nothing must SAY it does nothing on purpose — an
      // empty block with a comment inside is allowed, a bare `{}` is not.
      'no-empty': ['error', { allowEmptyCatch: false }],

      // ── Honesty about async ────────────────────────────────────────────────
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // ── Noise this codebase deliberately allows ────────────────────────────
      // Template literals over unions/numbers are how every label is built.
      '@typescript-eslint/restrict-template-expressions': 'off',
      // The bridge returns `unknown` by contract; callers narrow it.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // Tests reach into shapes on purpose to reproduce real bad data.
  {
    files: ['src/**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
