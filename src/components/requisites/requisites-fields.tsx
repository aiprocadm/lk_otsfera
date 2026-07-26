'use client';

import React, { useState } from 'react';
import { Input, Field } from '@/components/ui';
import { PartyAutocomplete, type PartyAutocompleteSuggestion } from '@/components/party/party-autocomplete';

/**
 * Этап 8 (ФТ-9.2, PR-1) — презентационный блок полей реквизитов, общий для
 * форм организации/партнёра/компании (строго presentational + domain-agnostic
 * тип — допустимое исключение из sibling-rule §4). Юр. название — через
 * PartyAutocomplete (DaData): выбор подсказки автозаполняет ИНН/КПП/ОГРН/адрес;
 * при выключенной интеграции остаётся обычным вводом.
 */

export type RequisitesDefaults = {
  legalName: string | null;
  inn: string | null;
  kpp: string | null;
  ogrn: string | null;
  legalAddress: string | null;
  bankName: string | null;
  bankAccount: string | null;
  corrAccount: string | null;
  bic: string | null;
  signerName: string | null;
  signerPosition: string | null;
  signerBasis: string | null;
};

export function RequisitesFields({ defaults, idPrefix }: { defaults: RequisitesDefaults; idPrefix: string }) {
  const [legalName, setLegalName] = useState(defaults.legalName ?? '');
  const [inn, setInn] = useState(defaults.inn ?? '');
  const [kpp, setKpp] = useState(defaults.kpp ?? '');
  const [ogrn, setOgrn] = useState(defaults.ogrn ?? '');
  const [legalAddress, setLegalAddress] = useState(defaults.legalAddress ?? '');

  function applySuggestion(s: PartyAutocompleteSuggestion): void {
    setLegalName(s.name);
    setInn(s.inn);
    if (s.kpp) setKpp(s.kpp);
    if (s.ogrn) setOgrn(s.ogrn);
    if (s.address) setLegalAddress(s.address);
  }

  const id = (k: string) => `${idPrefix}-${k}`;

  return (
    <div className='space-y-3'>
      <Field htmlFor={id('legalName')} label='Юридическое название'>
        <PartyAutocomplete
          id={id('legalName')}
          name='legalName'
          value={legalName}
          onChange={setLegalName}
          onSelect={applySuggestion}
          placeholder='ООО «Ромашка» — или начните вводить ИНН'
          maxLength={300}
        />
      </Field>
      <div className='grid grid-cols-1 sm:grid-cols-3 gap-3'>
        <Field htmlFor={id('inn')} label='ИНН'>
          <Input id={id('inn')} name='inn' inputMode='numeric' maxLength={12} value={inn} onChange={(e) => setInn(e.target.value)} />
        </Field>
        <Field htmlFor={id('kpp')} label='КПП'>
          <Input id={id('kpp')} name='kpp' inputMode='numeric' maxLength={9} value={kpp} onChange={(e) => setKpp(e.target.value)} />
        </Field>
        <Field htmlFor={id('ogrn')} label='ОГРН'>
          <Input id={id('ogrn')} name='ogrn' inputMode='numeric' maxLength={15} value={ogrn} onChange={(e) => setOgrn(e.target.value)} />
        </Field>
      </div>
      <Field htmlFor={id('legalAddress')} label='Юридический адрес'>
        <Input
          id={id('legalAddress')}
          name='legalAddress'
          maxLength={300}
          value={legalAddress}
          onChange={(e) => setLegalAddress(e.target.value)}
        />
      </Field>
      <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
        <Field htmlFor={id('bankName')} label='Банк'>
          <Input id={id('bankName')} name='bankName' maxLength={300} defaultValue={defaults.bankName ?? ''} />
        </Field>
        <Field htmlFor={id('bic')} label='БИК'>
          <Input id={id('bic')} name='bic' inputMode='numeric' maxLength={9} defaultValue={defaults.bic ?? ''} />
        </Field>
        <Field htmlFor={id('bankAccount')} label='Расчётный счёт'>
          <Input id={id('bankAccount')} name='bankAccount' inputMode='numeric' maxLength={20} defaultValue={defaults.bankAccount ?? ''} />
        </Field>
        <Field htmlFor={id('corrAccount')} label='Корреспондентский счёт'>
          <Input id={id('corrAccount')} name='corrAccount' inputMode='numeric' maxLength={20} defaultValue={defaults.corrAccount ?? ''} />
        </Field>
      </div>
      <div className='grid grid-cols-1 sm:grid-cols-3 gap-3'>
        <Field htmlFor={id('signerName')} label='Подписант (ФИО)'>
          <Input id={id('signerName')} name='signerName' maxLength={300} defaultValue={defaults.signerName ?? ''} />
        </Field>
        <Field htmlFor={id('signerPosition')} label='Должность'>
          <Input id={id('signerPosition')} name='signerPosition' maxLength={300} defaultValue={defaults.signerPosition ?? ''} />
        </Field>
        <Field htmlFor={id('signerBasis')} label='Действует на основании'>
          <Input id={id('signerBasis')} name='signerBasis' maxLength={300} defaultValue={defaults.signerBasis ?? ''} placeholder='Устава / доверенности №…' />
        </Field>
      </div>
    </div>
  );
}
