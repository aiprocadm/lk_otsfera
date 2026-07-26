import path from 'node:path';
import { Font } from '@react-pdf/renderer';

/**
 * Этап 8 (PR-2) — кириллический шрифт для генерируемых PDF. DejaVu Sans
 * (свободная лицензия, файл public/fonts/DejaVu-LICENSE.txt) — стандартная
 * Helvetica в @react-pdf кириллицу не содержит. Регистрация идемпотентна
 * (Font.register перезаписывает семейство без ошибок; флаг экономит IO).
 */

export const PDF_FONT_FAMILY = 'DejaVu';

let registered = false;

export function registerPdfFonts(): void {
  if (registered) return;
  const dir = path.join(process.cwd(), 'public', 'fonts');
  Font.register({
    family: PDF_FONT_FAMILY,
    fonts: [
      { src: path.join(dir, 'DejaVuSans.ttf'), fontWeight: 'normal' },
      { src: path.join(dir, 'DejaVuSans-Bold.ttf'), fontWeight: 'bold' }
    ]
  });
  registered = true;
}
