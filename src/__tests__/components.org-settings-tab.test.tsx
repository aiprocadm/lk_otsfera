import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import { OrgSettingsTab } from '@/components/organization/org-settings-tab';
import { OrgRequisitesView } from '@/components/organization/org-requisites-view';
import { OrgCommissionSection } from '@/components/organization/org-commission-section';

/**
 * `У-99`: вкладка «Настройки» карточки организации — общая рамка на все
 * кабинеты. Проверяем ровно то, ради чего требование появилось: названия и
 * порядок берутся из реестра, а не пишутся на каждом экране заново.
 */
const EMPTY_REQ = {
  inn: null,
  kpp: null,
  legalName: null,
  ogrn: null,
  legalAddress: null,
  bankName: null,
  bankAccount: null,
  corrAccount: null,
  bic: null,
  signerName: null,
  signerPosition: null,
};

describe('OrgSettingsTab (У-99)', () => {
  it('рисует секции в порядке реестра и с его названиями', () => {
    const html = renderToString(
      <OrgSettingsTab
        cabinet="admin"
        slots={{
          requisites: <p>РЕКВИЗИТЫ</p>,
          cabinetAccess: <p>ДОСТУП</p>,
          managers: <p>МЕНЕДЖЕРЫ</p>,
        }}
      />
    );
    expect(html).toContain('Реквизиты');
    expect(html).toContain('Доступ в кабинет');
    expect(html).toContain('Менеджеры организации');
    expect(html.indexOf('РЕКВИЗИТЫ')).toBeLessThan(html.indexOf('ДОСТУП'));
    expect(html.indexOf('ДОСТУП')).toBeLessThan(html.indexOf('МЕНЕДЖЕРЫ'));
  });

  it('секцию без содержимого не показывает — пустая секция это дефект (У-74)', () => {
    const html = renderToString(
      <OrgSettingsTab cabinet="admin" slots={{ requisites: <p>РЕКВИЗИТЫ</p> }} />
    );
    expect(html).toContain('Реквизиты');
    expect(html).not.toContain('Менеджеры организации');
  });

  it('секция, не положенная кабинету, не появится даже если её передали', () => {
    // Заказчику ставку комиссии не показывают: реестр решает, а не вызывающий.
    const html = renderToString(
      <OrgSettingsTab cabinet="organization" slots={{ commission: <p>СТАВКА</p> }} />
    );
    expect(html).not.toContain('СТАВКА');
  });

  it('совсем пустые настройки объясняют себя (У-74)', () => {
    const html = renderToString(<OrgSettingsTab cabinet="manager" slots={{}} />);
    expect(html).toContain('Настройки этой организации вам недоступны');
  });
});

describe('OrgRequisitesView', () => {
  it('пустые реквизиты объясняют, кто их заполняет (У-74)', () => {
    const html = renderToString(<OrgRequisitesView requisites={EMPTY_REQ} />);
    expect(html).toContain('Реквизиты не заполнены');
  });

  it('показывает заполненные значения и прочерки для пустых', () => {
    const html = renderToString(
      <OrgRequisitesView requisites={{ ...EMPTY_REQ, inn: '7707083893', bankName: 'Банк' }} />
    );
    expect(html).toContain('7707083893');
    expect(html).toContain('Банк');
    expect(html).toContain('—');
  });

  it('подписант: должность через запятую, без неё — без висящей запятой', () => {
    const withPos = renderToString(
      <OrgRequisitesView
        requisites={{ ...EMPTY_REQ, signerName: 'Иванов И.И.', signerPosition: 'Директор' }}
      />
    );
    expect(withPos).toContain('Иванов И.И., Директор');

    const withoutPos = renderToString(
      <OrgRequisitesView requisites={{ ...EMPTY_REQ, signerName: 'Иванов И.И.' }} />
    );
    expect(withoutPos).toContain('Иванов И.И.');
    expect(withoutPos).not.toContain('Иванов И.И.,');
  });
});

describe('OrgCommissionSection', () => {
  const ROW = {
    id: 'ch-1',
    oldRate: 0.05,
    newRate: 0.1,
    effectiveFrom: new Date('2026-03-01'),
    changedByName: 'Админ',
  };

  it('без индивидуальной ставки говорит, что действует базовая', () => {
    const html = renderToString(<OrgCommissionSection rate={null} note={null} history={[]} />);
    expect(html).toContain('Индивидуальной ставки нет');
    expect(html).toContain('ещё не меняли');
  });

  it('со ставкой показывает процент и основание, историю — таблицей', () => {
    const html = renderToString(
      <OrgCommissionSection rate={0.08} note="VIP" history={[ROW]} form={<p>ФОРМА</p>} />
    );
    expect(html).toMatch(/8\s*%/);
    expect(html).toContain('VIP');
    expect(html).toContain('Админ');
    expect(html).toContain('ФОРМА');
  });

  it('сброс ставки в истории подписан словами, пустое «было» — прочерком', () => {
    const html = renderToString(
      <OrgCommissionSection
        rate={null}
        note={null}
        history={[{ ...ROW, id: 'ch-2', oldRate: null, newRate: null, changedByName: null }]}
      />
    );
    expect(html).toContain('сброс (ставка партнёра)');
    expect(html).toContain('—');
  });

  it('история не передана — блок истории не рисуется вовсе', () => {
    // Партнёру историю не отдают. Показать ему пустую значило бы соврать
    // «ставку не меняли».
    const html = renderToString(<OrgCommissionSection rate={0.08} note={null} />);
    expect(html).not.toContain('История изменений');
  });
});
