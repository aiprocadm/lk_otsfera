import { describe, it, expect } from 'vitest';
import {
  analyzeScreen,
  cabinetOf,
  componentImports,
  findGaps,
  pickSample,
  renderSummary,
  routeOf,
  stripComments,
  summarize,
  type ScreenRow,
  type ScreenSignals,
} from '@/lib/acceptance/screenRules';

/**
 * Правила приёмки §0 (`У-175`): чистые функции скрипта `screen-acceptance`.
 * Признаки проверяются на фикстурах-строках — по одной на каждый ответ «где
 * я / что здесь / что дальше», выборка — на детерминированность и раскладку
 * по кабинетам.
 */

const PAGE_OK = `
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui';
import { Editor } from './editor';
export default function Page() {
  return (
    <div>
      <PageHeader title="Документы" subtitle="Счета, акты и договоры по заказам." />
      <Button>Добавить</Button>
    </div>
  );
}`;

const PAGE_CARD = `
import { PageHeader } from '@/components/ui/page-header';
export default function Page({ card }) {
  return <PageHeader title={card.name} subtitle={null} action={<form action={save}>…</form>} />;
}`;

const PAGE_BARE = `
import { PageHeader } from '@/components/ui/page-header';
export default function Page() {
  return <PageHeader title="Admin · Documents" subtitle="x" />;
}`;

const GATEWAY = `
import { redirect } from 'next/navigation';
export default function Page() { redirect('/manager/exchange/excel'); }`;

describe('cabinetOf / routeOf — кабинет и маршрут из пути файла', () => {
  it('первый сегмент после src/app — кабинет; группы (auth) и page.tsx не считаются', () => {
    expect(cabinetOf('src/app/admin/organizations/[id]/page.tsx')).toBe('admin');
    expect(cabinetOf('src/app/(auth)/login/page.tsx')).toBe('other');
    expect(cabinetOf('src/app/help/page.tsx')).toBe('other');
    expect(cabinetOf('src\\app\\partner\\orders\\page.tsx')).toBe('partner');
    expect(routeOf('src/app/admin/organizations/[id]/page.tsx')).toBe('/admin/organizations/[id]');
    expect(routeOf('src/app/(auth)/login/page.tsx')).toBe('/login');
  });
});

describe('stripComments / componentImports — цепочка экрана', () => {
  it('вырезает JSX-, блочные и строчные комментарии', () => {
    expect(stripComments('a {/* <h1> */} b /* <Button */ c // <form\nd')).toBe('a  b  c \nd');
  });

  it('берёт импорты @/components и относительные, без повторов и без закомментированных', () => {
    const src = `
import { A } from '@/components/a';
import { B } from '@/components/a';
import { C } from './c';
import { D } from '../d/index';
import { X } from '@/lib/x';
// import { Z } from '@/components/z';
`;
    expect(componentImports(src)).toEqual(['@/components/a', './c', '../d/index']);
  });
});

describe('analyzeScreen — три вопроса по исходникам', () => {
  it('русский заголовок, подзаголовок и кнопка — все три ответа есть', () => {
    expect(analyzeScreen([PAGE_OK])).toEqual({
      title: 'ru',
      subtitle: 'yes',
      action: true,
      emptyState: false,
      gateway: false,
    });
  });

  it('карточка сущности: имя из данных, подзаголовок снят осознанно, форма — действие', () => {
    expect(analyzeScreen([PAGE_CARD])).toMatchObject({
      title: 'dynamic',
      subtitle: 'card',
      action: true,
    });
  });

  it('заголовок латиницей — заглушка, а не название раздела', () => {
    expect(analyzeScreen([PAGE_BARE]).title).toBe('latin');
  });

  it('литералы в фигурных скобках и шаблонные строки читаются как текст', () => {
    expect(analyzeScreen(["<PageHeader title={'Заказы'} subtitle='a' />"]).title).toBe('ru');
    expect(analyzeScreen(['<PageHeader title={`Заказ ${n}`} subtitle="a" />']).title).toBe('ru');
    expect(analyzeScreen(["<PageHeader title={'Orders'} subtitle='a' />"]).title).toBe('latin');
  });

  it('шапка без title в окне пропускается, дальше ищется <h1>', () => {
    const src = '<PageHeader subtitle="a" />\n<h1 className="x">Финансы</h1>';
    expect(analyzeScreen([src]).title).toBe('ru');
    expect(analyzeScreen(['<h1>{org.name}</h1>']).title).toBe('dynamic');
    expect(analyzeScreen(['<h1>Dashboard</h1>']).title).toBe('latin');
    expect(analyzeScreen(['<div>ничего</div>']).title).toBe('none');
  });

  it('комментарии не считаются: «<h1>» и «<Button>» в объяснении — не разметка', () => {
    const src = '/* раньше тут был <h1>Заказы</h1> и <Button> */ <div />';
    expect(analyzeScreen([src])).toMatchObject({ title: 'none', action: false });
  });

  it('подзаголовок: есть хоть в одной шапке — «yes»; только null — «card»; ни одной — «none»', () => {
    const card = '<PageHeader title="А" subtitle={null} />';
    const yes = '<PageHeader title="Б" subtitle="объяснение" />';
    expect(analyzeScreen([card, yes]).subtitle).toBe('yes');
    expect(analyzeScreen([card]).subtitle).toBe('card');
    expect(analyzeScreen(['<h1>А</h1>']).subtitle).toBe('none');
  });

  it.each([
    ['<Button>', '<Button>Сохранить</Button>'],
    ['<button>', '<button type="submit">Ок</button>'],
    ['компонент-кнопка', '<SyncTriggerButton />'],
    ['<form>', '<form action={act}></form>'],
    ['ExportLink', '<ExportLink href="/x" />'],
    ['BackLink', '<BackLink href="/dashboard" label="Назад" />'],
    ['ссылка-кнопка', '<Link href="/x" className="bg-[#F97316] text-white">+</Link>'],
    ['карточка хаба', '<Link href="/x" className="border hover:border-[#F97316]">…</Link>'],
  ])('«что дальше»: %s — действие', (_name, src) => {
    expect(analyzeScreen([src]).action).toBe(true);
  });

  it('обычная ссылка в таблице — не главное действие', () => {
    expect(analyzeScreen(['<Link href="/x" className="text-gray-500">→</Link>']).action).toBe(
      false
    );
  });

  it('EmptyState — ответ на «что дальше» для пустого экрана', () => {
    const s = analyzeScreen(['<EmptyState message="Пусто, нажмите…" />']);
    expect(s.emptyState).toBe(true);
    expect(s.action).toBe(false);
  });

  it('шлюз — нет шапки, есть redirect; без redirect это просто экран без заголовка', () => {
    expect(analyzeScreen([GATEWAY]).gateway).toBe(true);
    expect(analyzeScreen(['<div />']).gateway).toBe(false);
    expect(analyzeScreen([]).gateway).toBe(false);
  });

  it('заголовок берётся из первой шапки цепочки — страница важнее компонента', () => {
    expect(analyzeScreen([PAGE_BARE, PAGE_OK]).title).toBe('latin');
  });
});

const signals = (over: Partial<ScreenSignals> = {}): ScreenSignals => ({
  title: 'ru',
  subtitle: 'yes',
  action: true,
  emptyState: false,
  gateway: false,
  ...over,
});
const row = (file: string, over: Partial<ScreenSignals> = {}): ScreenRow => ({
  file,
  route: routeOf(file),
  cabinet: cabinetOf(file),
  status: 'A',
  signals: signals(over),
});

describe('summarize / findGaps / renderSummary — таблица для close-out', () => {
  const rows: ScreenRow[] = [
    row('src/app/admin/a/page.tsx'),
    row('src/app/admin/b/page.tsx', { title: 'none', gateway: true }),
    row('src/app/admin/c/page.tsx', { title: 'latin', subtitle: 'none', action: false }),
    row('src/app/partner/d/page.tsx', { subtitle: 'card', action: false, emptyState: true }),
    row('src/app/help/page.tsx', { title: 'dynamic' }),
  ];

  it('считает по кабинетам, шлюзы отдельно, пустые кабинеты не печатает', () => {
    expect(summarize(rows)).toEqual([
      { cabinet: 'admin', screens: 3, gateways: 1, whereAmI: 1, whatHere: 1, whatNext: 1 },
      { cabinet: 'partner', screens: 1, gateways: 0, whereAmI: 1, whatHere: 1, whatNext: 1 },
      { cabinet: 'other', screens: 1, gateways: 0, whereAmI: 1, whatHere: 1, whatNext: 1 },
    ]);
  });

  it('пробелы — только у экранов, а не у шлюзов; каждый вопрос назван', () => {
    expect(findGaps(rows)).toEqual([
      {
        route: '/admin/c',
        file: 'src/app/admin/c/page.tsx',
        missing: [
          'где я (заголовок: latin)',
          'что здесь (нет подзаголовка)',
          'что дальше (нет кнопки и пустого состояния)',
        ],
      },
    ]);
  });

  it('markdown-таблица в виде close-out У-77', () => {
    expect(renderSummary(summarize(rows))).toBe(
      [
        '| Кабинет | Экранов всего | Где я | Что здесь | Что дальше |',
        '|---|---|---|---|---|',
        '| Администратор | 3 (шлюзов: 1) | 1 из 2 | 1 из 2 | 1 из 2 |',
        '| Партнёр | 1 | 1 из 1 | 1 из 1 | 1 из 1 |',
        '| Вне кабинетов | 1 | 1 из 1 | 1 из 1 | 1 из 1 |',
      ].join('\n')
    );
  });
});

describe('pickSample — воспроизводимая выборка глазами', () => {
  const files = [
    ...Array.from({ length: 12 }, (_, i) => `src/app/admin/s${i}/page.tsx`),
    ...Array.from({ length: 18 }, (_, i) => `src/app/leader/s${i}/page.tsx`),
    ...Array.from({ length: 7 }, (_, i) => `src/app/manager/s${i}/page.tsx`),
    'src/app/organization/company/page.tsx',
    'src/app/organization/company/students/[studentId]/page.tsx',
    ...Array.from({ length: 3 }, (_, i) => `src/app/partner/s${i}/page.tsx`),
  ];

  it('seed=175 дважды — один и тот же список, порядок входа не важен', () => {
    const a = pickSample(files, 12, 175);
    const b = pickSample([...files].reverse(), 12, 175);
    expect(a).toEqual(b);
    expect(a).toHaveLength(12);
    expect(new Set(a).size).toBe(12);
  });

  it('по два на кабинет, остаток — кабинетам с бо́льшим числом экранов', () => {
    const counts = new Map<string, number>();
    for (const f of pickSample(files, 12, 175)) {
      counts.set(cabinetOf(f), (counts.get(cabinetOf(f)) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({
      admin: 3,
      leader: 3,
      manager: 2,
      organization: 2,
      partner: 2,
    });
  });

  it('другое зерно — другая выборка', () => {
    expect(pickSample(files, 12, 175)).not.toEqual(pickSample(files, 12, 77));
  });

  it('просят больше, чем есть — отдаёт всё и не зацикливается; ноль — пусто', () => {
    expect(pickSample(files.slice(-5), 12, 1)).toHaveLength(5);
    expect(pickSample(files, 0, 1)).toEqual([]);
  });
});
