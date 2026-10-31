# Переход на ветки `staging → main` — выключенные заготовки

**Требование:** `У-344` (ТЗ 28.10.2026, ДП §7). **Состояние: выключено.** Файлы этой папки GitHub не исполняет и
не читает: workflow берутся только из `.github/workflows/`, `CODEOWNERS` — только из корня, `.github/` или `docs/`.
Страж `infra.staging-switch` следит, чтобы заготовки не включились раньше времени.

## Когда включать

Только когда владелец сделал всё из списка (действия `Н-9`, `Н-11`, `Н-5` из §6 ТЗ):

1. Тариф GitHub с защитой веток для приватного репозитория (Pro или Team) — без него rulesets и обязательный
   `CODEOWNERS` не работают.
2. Создана ветка `staging` из `main`: `git push origin origin/main:refs/heads/staging`.
3. Разрешена правка CLAUDE.md §11 (новый workflow) и §14 (правило «PR всегда с `base: main`»), а также
   `renovate.json`.
4. Отдельная учётная запись GitHub для агента — только push в свои ветки и создание PR (`Н-11`).
5. Есть чем исполнять проверки: оплачены минуты Actions или поднят self-hosted runner на сборочной машине —
   не на агентском сервере и не на проде (`Н-5`).

До этого действует старое правило: агент открывает PR с `base: main`.

## Что переключить (один PR от `main`, затем back-merge в `staging`)

| Что | Сейчас | После переключения |
|---|---|---|
| `CODEOWNERS` | `.github/CODEOWNERS` — владелец на всё | заменить содержимым [`CODEOWNERS.template`](CODEOWNERS.template) (чувствительные пути поимённо) |
| `ci.yml`: триггеры | `pull_request`, `push: [main]` | `push: [main, staging]`; `pull_request` — без изменений |
| `ci.yml`: джоб `source-branch` | нет | вставить [`ci-source-branch.job.yml`](ci-source-branch.job.yml) в `jobs:` |
| Автодеплой стейджинга | нет | перенести [`deploy-staging.yml`](deploy-staging.yml) в `.github/workflows/`; завести `vars.REGISTRY`, `vars.STAGING_HOST`, окружение `staging` |
| `renovate.json` | PR в ветку по умолчанию | добавить `"baseBranches": ["staging"]` |
| CLAUDE.md §14 | «PR всегда открывается с `base: main`» | «ветка задачи — от свежего `staging`, PR в `staging`; в `main` — только релизный PR из `staging` (merge commit) и `hotfix/*`» |
| CLAUDE.md §11 | «`ci.yml` — единственный workflow» | добавить `deploy-staging.yml` как разрешённый второй |
| CLAUDE.md §14, `Р-ТР-3` | агент вливает PR сам после зелёных гейтов | PR в `staging` вливает человек после ревью; агент не мержит и не меняет настройки репозитория |
| Страж `infra.staging-switch` | проверяет, что заготовки выключены | первый блок перевернуть: `deploy-staging.yml` в `workflows/`, `source-branch` в `ci.yml`, `CODEOWNERS` = заготовка |

## Защита веток (rulesets, настраивает владелец)

- **`main`:** только PR; без push, force-push и удаления; одобрение владельца через `CODEOWNERS`; обязательные
  проверки CI и `source-branch`; новый push сбрасывает одобрение; линейная история выключена (релизный PR —
  merge commit).
- **`staging`:** только PR; одно одобрение человека; `CODEOWNERS` для чувствительных путей; новый push сбрасывает
  одобрение.
- **Теги `v*`:** ставит только владелец. Обход правил — только владелец, в аварии.

## Как теперь идёт задача

Ветка задачи от `staging` (`feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `migrate/`; `hotfix/` — от `main`) →
PR в `staging` с шаблоном → проверки → ревью человека → squash → автодеплой на стейджинг → приёмка → релизный PR
`staging → main` (merge commit) → тег `vX.Y.Z` → прод по [ранбуку выкладки](../../docs/runbook-release.md),
фаза E. Хотфикс — там же.
