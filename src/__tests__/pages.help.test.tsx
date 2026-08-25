// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderServerComponent } from './helpers/renderServerComponent';

/**
 * Страница словаря `/help` (`У-76`).
 *
 * Экран живёт вне кабинетов, поэтому проверяем не только содержимое, но и то,
 * что человек не остаётся в тупике без меню (§15 «что делать дальше»).
 */
const { requireSession } = vi.hoisted(() => ({
  requireSession: vi.fn(async () => ({ sub: 'u1', role: 'partner' })),
}));
vi.mock('@/lib/auth/requireRole', () => ({ requireSession }));

import HelpPage from '@/app/help/page';

describe('страница /help (У-76)', () => {
  it('требует входа и показывает разделы словаря', async () => {
    const { container } = await renderServerComponent(HelpPage());
    expect(requireSession).toHaveBeenCalled();

    // `У-106`: заголовок экрана равен пункту меню, а пояснение живёт
    // подзаголовком — иначе человек кликает «Справку», а попадает на
    // «Справку: словарь терминов» и не уверен, туда ли он пришёл.
    expect(container.querySelector('h1')?.textContent).toBe('Справка');
    expect(container.textContent).toContain('простыми словами');
    // §15: подзаголовок «что здесь делают».
    expect(container.textContent).toContain('Что означают слова');
    // Все четыре раздела смонтированы.
    for (const id of ['confusing', 'sales', 'people', 'docs-money']) {
      expect(container.querySelector(`[data-testid="glossary-section-${id}"]`)).not.toBeNull();
    }
  });

  it('объясняет самую частую путаницу словами пользователя', async () => {
    const { container } = await renderServerComponent(HelpPage());
    const text = container.textContent ?? '';
    expect(text).toContain('обращение — это разговор');
    expect(text).toContain('Заявка — это список людей');
    // Внутренние названия таблиц пользователю не показываем.
    expect(text).not.toContain('ClientRequest');
    expect(text).not.toContain('EnrollmentRequest');
  });

  it('из словаря есть выход обратно в кабинет — экран вне меню', async () => {
    const { container } = await renderServerComponent(HelpPage());
    const back = container.querySelector('a[href="/dashboard"]');
    expect(back).not.toBeNull();
    expect(back?.textContent).toContain('Вернуться в кабинет');
  });
});
