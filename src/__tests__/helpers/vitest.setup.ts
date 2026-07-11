// Глушим журнал ПДн в тестовом env: прод-семантика флага — opt-out (default ON),
// но сотни существующих unit-тестов зовут сервисы с mock-prisma без
// `piiAccessEvent` — без этой строки каждый такой вызов давал бы шумовой
// log.error из recordPiiAccess (fail-open) и ломал console-spy регрессы.
// Тесты самого журнала выставляют FEATURE_PII_ACCESS_LOG='1' явно.
process.env.FEATURE_PII_ACCESS_LOG ??= '0';
