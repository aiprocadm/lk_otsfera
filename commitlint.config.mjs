// Conventional Commits (фаза 1). История репозитория уже следует конвенции
// (feat/fix/chore/docs/test/refactor + scope) — конфиг фиксирует её механически.
// Русский язык в subject разрешён, поэтому отключаем case-проверки.
const config = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Русские заголовки: «Ф4 — страницы…» не должны падать на sentence-case.
    'subject-case': [0],
    // Исторические коммиты длиннее 100 символов встречаются; держим мягкий лимит.
    'header-max-length': [2, 'always', 120],
  },
};

export default config;
