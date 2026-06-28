# Spec: 6-стадийный рабочий статус заказа (gap #5)

**Дата:** 2026-06-24
**Источник:** ТЗ «Личный кабинет Промтехносфера» v0.4 — §10
**Статус:** design (autonomous goal-run). **Подход утверждён владельцем: производный слой.**
Точные названия 6 стадий §10 владелец не прислал → ниже **предложенный дефолт** (помечен),
поправить на review (производный слой — относки/переименование тривиальны).
**Память:** [[project-tz-v04-gap-program-2026-06-23]] gap #5.

## 1. Проблема и контекст

§10 ТЗ требует **6-стадийный рабочий статус заказа**. В коде `ExecutionStatus` = 5 значений
(pending/in_progress/completed/cancelled/on_hold) + производный слой
[lib/orders/humanStage.ts](src/lib/orders/humanStage.ts) (`executionStage`/`paymentStage`/`orderStage`),
который уже выводит человекочитаемый статус из enum + чисел + (потенциально) дат.

**Решение (утверждено владельцем):** НЕ менять core-enum `ExecutionStatus` (высокий риск:
миграция enum, 1С-`translate`/mappers, ~24 файла) — вместо этого добавить **производную**
6-стадийную «дорожку» в `humanStage.ts`, выводимую из уже существующих полей `Order`. Обратимо,
нулевой риск для данных и 1С.

## 2. Производная 6-стадийная дорожка (предложенный дефолт — подтвердить §10)

Монотонная «максимально достигнутая веха» из полей `Order` (executionStatus, contractSignedAt,
paidAmount/totalAmount, completedAt, closedAt):

| # | Стадия (предлагается) | Условие достижения |
|---|---|---|
| 1 | Новая | заказ создан (дефолт) |
| 2 | Договор | `contractSignedAt != null` |
| 3 | Оплата | `paidAmount > 0` |
| 4 | Обучение | `executionStatus === 'in_progress'` |
| 5 | Документы | `executionStatus === 'completed' && closedAt == null` |
| 6 | Закрыт | `closedAt != null` |

Текущая стадия = максимальный достигнутый индекс (берётся самый «дальний» выполненный
критерий, не первый). Терминальные состояния вне дорожки: `cancelled` → «Отменён» (danger),
`on_hold` → «На паузе» (warning) — показываются вместо дорожки.

**Открытый вопрос (review):** точные названия/порядок 6 стадий из §10. Изменение = правка
таблицы меток + условий в одной чистой функции (без миграции).

## 3. API (`lib/orders/humanStage.ts`)

Добавить **чистую** функцию (рядом с `orderStage`), переиспользуя `Stage`/`StageTone`:
```ts
export type WorkingStageInput = {
  executionStatus: ExecutionStatus;
  contractSignedAt: Date | string | null;
  completedAt: Date | string | null;
  closedAt: Date | string | null;
  amount: string | number;     // totalAmount
  paidTotal: string | number;  // paidAmount
};
export type WorkingStage = {
  index: number;      // 1..6 (0 для терминальных вне дорожки)
  total: 6;
  label: string;
  tone: StageTone;
  terminal: boolean;  // cancelled/on_hold — вне дорожки
};
export function orderWorkingStage(input: WorkingStageInput): WorkingStage;
```
Чистая, без I/O. Существующие `executionStage`/`paymentStage`/`orderStage` **не трогаем**
(их потребители стабильны) — это дополнение.

## 4. UI

- **`OrderStageStepper`** (`src/components/orders/order-stage-stepper.tsx`) — презентационный
  6-шаговый индикатор: точки/сегменты 1..6, текущая подсвечена, пройденные отмечены, метки
  стадий; терминальный (`cancelled`/`on_hold`) → одиночный бейдж вместо дорожки. Только
  `ui/`-примитивы + Tailwind-палитра (без инлайн-hex). Domain-agnostic (принимает `WorkingStage`
  + список меток).
- **Встраивание** — в карточке заказа во всех кабинетах, где уже есть order detail (manager/admin/
  leader через `ManagerOrderDetailView`/admin page; organization order detail; partner deal detail).
  Данные уже загружены (executionStatus/даты/суммы на заказе) — стадия считается на сервере и
  передаётся в компонент (или считается в компоненте из переданных полей).
- Списки заказов **не трогаем** (там остаётся компактный `executionStage`-бейдж) — дорожка
  избыточна в строке таблицы.

## 5. RBAC / безопасность

Нет новых данных и мутаций — только производное отображение уже-видимых полей заказа. Видимость
наследует существующий order-scope (стадия показывается там, где заказ уже виден). Нет влияния на
1С/комиссии/enum.

## 6. Тесты (§6)

- **Unit** (`orders.workingStage.test.ts`): дорожка по каждой вехе (1→6), монотонность (самая
  дальняя веха выигрывает: completed+closed → 6, не 2), терминальные cancelled/on_hold
  (`terminal:true`, index 0), граничные (paidAmount=0 vs >0; completed без closedAt → 5; closedAt → 6),
  Decimal-строки и number оба принимаются.
- **Component** (`components.order-stage-stepper.test.tsx`): рендер 6 шагов с подсветкой текущей;
  терминальный → одиночный бейдж.
- **Coverage**: `orderWorkingStage` под порог 100% (§6 фаза 1, `lib/**/!(*.tsx)`).

## 7. Вне объёма (явно)

- Смена enum `ExecutionStatus` (отвергнуто владельцем — риск).
- Редактирование стадии вручную (стадия производная, меняется через executionStatus/даты/оплаты).
- Точные метки §10 (ASSUMPTION — подтвердить; правка тривиальна).
- Стадия в списках заказов (оставляем executionStage-бейдж).

## 8. Критерии приёмки

1. `orderWorkingStage` детерминированно возвращает 1..6 по самой дальней достигнутой вехе;
   cancelled/on_hold → terminal-бейдж.
2. В карточке заказа во всех кабинетах виден 6-шаговый индикатор стадии с подсвеченной текущей.
3. Core-enum/1С/комиссии не затронуты; гейты зелёные (typecheck/lint/unit).
4. Метки/порядок стадий вынесены в одну точку (правка по §10 — без миграции).
