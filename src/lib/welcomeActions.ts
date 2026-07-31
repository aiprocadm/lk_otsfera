import { isFeatureEnabled } from '@/lib/featureFlags';
import type { WelcomeAction } from '@/components/welcome/welcome-card';

/**
 * Состав карточек welcome-блока (этап 4, ФТ-10.4, решение §8-3 спеки):
 * заявка на обучение / удостоверения / документы; разделы за выключенными
 * флагами заменяются на «Заказы» и «Финансы», чтобы карточек всегда было 3.
 * «Задать вопрос» появится в этапе 9 (Модуль 11).
 */
export function welcomeActionsFor(role: 'organization' | 'partner'): WelcomeAction[] {
  const base = role === 'partner' ? '/partner' : '/organization';
  const actions: WelcomeAction[] = [];
  if (isFeatureEnabled('enrollment_requests')) {
    actions.push({
      href: `${base}/enrollments`,
      title: 'Подать заявку на обучение',
      hint: 'Слушатели списком или из Excel, направление из справочника',
    });
  }
  if (isFeatureEnabled('certificates_registry')) {
    actions.push({
      href: `${base}/certificates`,
      title: 'Удостоверения',
      hint: 'Реестр с сроками действия и файлами',
    });
  }
  actions.push({
    href: `${base}/documents`,
    title: 'Документы',
    hint: 'Договоры, счета и акты — в одном месте',
  });
  const fallbacks: WelcomeAction[] = [
    {
      href: role === 'partner' ? `${base}/portfolio` : `${base}/orders`,
      title: role === 'partner' ? 'Портфель' : 'Заказы',
      hint: 'Текущие заказы и их статусы',
    },
    { href: `${base}/finance`, title: 'Финансы', hint: 'Платежи и задолженность' },
  ];
  for (const fb of fallbacks) {
    if (actions.length >= 3) break;
    actions.push(fb);
  }
  return actions.slice(0, 3);
}
