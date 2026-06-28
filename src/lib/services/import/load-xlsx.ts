import ExcelJS from 'exceljs';

/**
 * Загрузка xlsx-книги из Node Buffer/ArrayBuffer.
 *
 * Типы ExcelJS объявляют `xlsx.load()` под DOM-`ArrayBuffer`; Node-`Buffer`
 * принимается в рантайме, но не проходит по типам. Cast изолирован здесь —
 * единственная аудируемая точка вместо дубля в каждом парсере импорта.
 */
export async function loadXlsxWorkbook(buffer: Buffer | ArrayBuffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- ExcelJS load() типизирован под DOM ArrayBuffer; Node Buffer работает в рантайме
  await wb.xlsx.load(buffer as any);
  return wb;
}
