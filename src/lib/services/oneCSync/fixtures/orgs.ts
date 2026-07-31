import type { OneCOrgDto } from '../dto';

export const FAKE_ORGS: OneCOrgDto[] = [
  {
    externalId: '1c-org-001',
    name: 'ООО «Завод Прима»',
    legalName: 'Общество с ограниченной ответственностью «Завод Прима»',
    inn: '7701234567',
    kpp: '770101001',
    partnerExternalId: '1c-partner-001',
    updatedAt: '2026-04-12T10:00:00Z',
  },
  {
    externalId: '1c-org-002',
    name: 'ОАО «Компас»',
    legalName: 'Открытое акционерное общество «Компас»',
    inn: '5024009999',
    kpp: '502401001',
    partnerExternalId: '1c-partner-001',
    updatedAt: '2026-04-15T11:00:00Z',
  },
  {
    externalId: '1c-org-003',
    name: 'ЗАО «Энерго»',
    legalName: 'Закрытое акционерное общество «Энерго»',
    inn: '5030005555',
    kpp: '503001001',
    partnerExternalId: '1c-partner-001',
    updatedAt: '2026-04-18T09:00:00Z',
  },
];
