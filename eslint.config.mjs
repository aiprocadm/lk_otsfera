import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const NO_HANDROLLED_MODAL = [
  'error',
  {
    selector: "JSXOpeningElement[name.name='dialog']",
    message: 'Use the shared <Dialog> primitive (src/components/ui/dialog.tsx) instead of a raw <dialog>.'
  },
  {
    selector: "JSXAttribute[name.name='role'][value.value='dialog']",
    message: 'Use the shared <Dialog> primitive instead of hand-rolling role="dialog".'
  },
  {
    selector: "JSXAttribute[name.name='aria-modal']",
    message: 'Use the shared <Dialog> primitive instead of hand-rolling aria-modal.'
  }
];

// CLAUDE.md §2 — dependency direction: app → server-actions → services → lib.
// A service must never import upward from the UI / route / mutation layers.
// `no-restricted-imports` (core) also catches `import type`, which is exactly the
// violation C3 fixed (dashboard services pulling return-types up from components).
const NO_UPWARD_IMPORTS_IN_SERVICES = [
  'error',
  {
    patterns: [
      {
        group: [
          '@/app', '@/app/*', '@/app/**',
          '@/components', '@/components/*', '@/components/**',
          '@/server-actions', '@/server-actions/*', '@/server-actions/**'
        ],
        message:
          'Service layer must not import upward from app/components/server-actions (CLAUDE.md §2: app → server-actions → services → lib). The service owns its types; the UI imports them down.'
      }
    ]
  }
];

// mock-1c/ is the dev/test-only 1С counterparty. Dependency direction is one-way:
// mock-1c may import src, but src must NEVER import mock-1c (it would pull throwaway
// test infra into the app runtime). Mirrors the C3 services↛app guardrail.
const NO_MOCK1C_FROM_SRC = {
  group: ['**/mock-1c', '**/mock-1c/**'],
  message: 'src/ must not import mock-1c (it is dev/test-only, outside the app runtime). Direction is one-way: mock-1c → src.'
};

export default [
  // Generated coverage reports (istanbul/v8 HTML output) are gitignored artifacts,
  // not source. They ship their own `/* eslint-disable */` banners which the flat
  // config flags as "unused directive". Never lint them, wherever they land.
  { ignores: ['**/coverage/**'] },
  ...coreWebVitals,
  ...typescript,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': NO_HANDROLLED_MODAL,
      'no-restricted-imports': ['error', { patterns: [NO_MOCK1C_FROM_SRC] }]
    }
  },
  {
    files: ['src/lib/services/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [...NO_UPWARD_IMPORTS_IN_SERVICES[1].patterns, NO_MOCK1C_FROM_SRC]
      }]
    }
  },
  {
    // The primitive is the one place allowed to use the native <dialog> element.
    files: ['src/components/ui/dialog.tsx'],
    rules: {
      'no-restricted-syntax': 'off'
    }
  },
  {
    files: ['src/__tests__/**/*.{ts,tsx}', 'src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off'
    }
  }
];
