import type { OneCOrgDto } from '../dto';

export const FAKE_ORGS: OneCOrgDto[] = [
  {
    externalId: '1c-org-001',
    name: 'ООО «Завод Прима»',
    legalName: 'Общество с ограниченной ответственностью «Завод Прима»',
    inn: '7701234567',
    kpp: '770101001',
    // `У-171`: полный набор реквизитов — как отдаёт 1С с заполненной карточкой.
    ogrn: '1027700123456',
    legalAddress: '101000, г. Москва, ул. Промышленная, д. 12, стр. 1',
    bankName: 'ПАО «Сбербанк»',
    bankAccount: '40702810400000012345',
    corrAccount: '30101810400000000225',
    bic: '044525225',
    signerName: 'Смирнов Алексей Петрович',
    signerPosition: 'Генеральный директор',
    signerBasis: 'Устава',
    partnerExternalId: '1c-partner-001',
    updatedAt: '2026-04-12T10:00:00Z',
  },
  {
    externalId: '1c-org-002',
    name: 'ОАО «Компас»',
    legalName: 'Открытое акционерное общество «Компас»',
    inn: '5024009999',
    kpp: '502401001',
    // `У-171`: карточка заполнена частично — банка и подписанта в 1С нет.
    ogrn: '1025002999999',
    legalAddress: '143400, Московская обл., г. Красногорск, ул. Ленина, д. 5',
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
