import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

const NO_HANDROLLED_MODAL = [
  'error',
  {
    selector: "JSXOpeningElement[name.name='dialog']",
    message:
      'Use the shared <Dialog> primitive (src/components/ui/dialog.tsx) instead of a raw <dialog>.',
  },
  {
    selector: "JSXAttribute[name.name='role'][value.value='dialog']",
    message: 'Use the shared <Dialog> primitive instead of hand-rolling role="dialog".',
  },
  {
    selector: "JSXAttribute[name.name='aria-modal']",
    message: 'Use the shared <Dialog> primitive instead of hand-rolling aria-modal.',
  },
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
          '@/app',
          '@/app/*',
          '@/app/**',
          '@/components',
          '@/components/*',
          '@/components/**',
          '@/server-actions',
          '@/server-actions/*',
          '@/server-actions/**',
        ],
        message:
          'Service layer must not import upward from app/components/server-actions (CLAUDE.md §2: app → server-actions → services → lib). The service owns its types; the UI imports them down.',
      },
    ],
  },
];

// mock-1c/ is the dev/test-only 1С counterparty. Dependency direction is one-way:
// mock-1c may import src, but src must NEVER import mock-1c (it would pull throwaway
// test infra into the app runtime). Mirrors the C3 services↛app guardrail.
const NO_MOCK1C_FROM_SRC = {
  group: ['**/mock-1c', '**/mock-1c/**'],
  message:
    'src/ must not import mock-1c (it is dev/test-only, outside the app runtime). Direction is one-way: mock-1c → src.',
};

const config = [
  // Generated coverage reports (istanbul/v8 HTML output) are gitignored artifacts,
  // not source. They ship their own `/* eslint-disable */` banners which the flat
  // config flags as "unused directive". Never lint them, wherever they land.
  { ignores: ['**/coverage/**', '.next/**', 'playwright-report/**', 'next-env.d.ts'] },
  ...coreWebVitals,
  ...typescript,
  // Фаза 1 «эталонного репозитория»: typed-правила @typescript-eslint.
  // projectService включает type-aware анализ (нужен tsconfig); правила ниже
  // ловят реальные баги асинхронности, которые обычный линт не видит.
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      // Потерянный промис = проглоченная ошибка/гонка. Осознанный
      // fire-and-forget помечается `void promise` (ignoreVoid).
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      // attributes:false — async-обработчики в JSX (`onClick={async …}`) —
      // штатный React-паттерн (возврат игнорируется); внутри они по-прежнему
      // под no-floating-promises. Остальные позиции проверяются полностью.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      // Синхронизировано с verbatimModuleSyntax (tsconfig): типы импортируются
      // только как типы. inline-стиль — `import { type X, y }`.
      // disallowTypeAnnotations:false — `typeof import('…')` остаётся легальным:
      // это штатный приём vitest (importActual) и Sentry-типов.
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', disallowTypeAnnotations: false },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      // Единый порядок импортов (autofix). Пустые строки между группами не
      // навязываем, чтобы не раздувать диff фазы 1.
      'import/order': [
        'error',
        {
          groups: [['builtin', 'external'], 'internal', ['parent', 'sibling', 'index']],
          pathGroups: [{ pattern: '@/**', group: 'internal' }],
          'newlines-between': 'ignore',
        },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': NO_HANDROLLED_MODAL,
      'no-restricted-imports': ['error', { patterns: [NO_MOCK1C_FROM_SRC] }],
      // PR-2 (observability): сырой console.* запрещён — только @/lib/logging
      // (server), @/lib/logging/edge (middleware), @/lib/logging/client ('use
      // client'). Транспорты внутри src/lib/logging/** несут точечные
      // eslint-disable с причиной; тесты — в override ниже.
      'no-console': 'error',
    },
  },
  {
    files: ['src/lib/services/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [...NO_UPWARD_IMPORTS_IN_SERVICES[1].patterns, NO_MOCK1C_FROM_SRC],
        },
      ],
    },
  },
  {
    // The primitive is the one place allowed to use the native <dialog> element.
    files: ['src/components/ui/dialog.tsx'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  {
    files: ['src/__tests__/**/*.{ts,tsx}', 'src/**/*.test.{ts,tsx}', 'src/**/*.spec.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      // Тесты спают/ассертят console (37 файлов graceful-degrade регрессов) —
      // запрет не для них.
      'no-console': 'off',
      // Тестовый идиом: импорт тестируемого модуля НАМЕРЕННО стоит после
      // vi.mock-настройки (page-тесты helpers/renderServerComponent), а fixer
      // не переносит импорты через не-импортные строки. В боевом коде
      // правило действует полностью.
      'import/order': 'off',
    },
  },
];

export default config;
