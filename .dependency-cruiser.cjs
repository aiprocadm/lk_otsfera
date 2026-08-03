/**
 * Границы модулей (фаза 3 «эталонного репозитория», решение заказчика
 * 31.07.2026: узаконена фактическая слоистая архитектура, а не src/modules).
 *
 * Направление зависимостей (CLAUDE.md §2):
 *   app → server-actions → services → lib;  worker → services/lib;
 *   components — презентационный слой, в базу не ходит.
 *
 * Запуск: npm run boundaries (входит в verify и CI). Нарушение = красная сборка.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'Циклы зависимостей запрещены — они склеивают модули в неразъёмный ком.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'services-no-upward',
      comment:
        'Сервис не импортирует UI/роуты/экшены (CLAUDE.md §2). Дублирует eslint-guardrail — здесь ловится и транзитивно.',
      severity: 'error',
      from: { path: '^src/lib/services' },
      to: { path: '^src/(app|components|server-actions)' },
    },
    {
      name: 'lib-no-upward',
      comment: 'Весь src/lib — нижний слой: наверх (app/components/server-actions) не смотрит.',
      severity: 'error',
      from: { path: '^src/lib' },
      to: { path: '^src/(app|components|server-actions)' },
    },
    {
      name: 'worker-no-ui',
      comment: 'Worker — отдельный процесс без UI: импорты из app/components запрещены.',
      severity: 'error',
      from: { path: '^src/worker' },
      to: { path: '^src/(app|components)' },
    },
    {
      name: 'server-actions-no-app',
      comment: 'server-actions — слой под app: обратных импортов из app быть не должно.',
      severity: 'error',
      from: { path: '^src/server-actions' },
      to: { path: '^src/app' },
    },
    {
      name: 'src-no-mock1c',
      comment: 'mock-1c — dev/test-контрагент вне рантайма приложения (направление одностороннее).',
      severity: 'error',
      from: { path: '^src' },
      to: { path: '^mock-1c' },
    },
    {
      name: 'components-no-db',
      comment: 'Компоненты в базу не ходят: запросы живут в services, данные приходят пропсами.',
      severity: 'error',
      from: { path: '^src/components' },
      to: { path: '^src/lib/db/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
