import React from 'react';

/**
 * `У-132` (дефект `Д-36`): предупреждение об отсутствии мастер-ключа
 * шифрования стоит ДО форм с секретами. Раньше об этом человек узнавал
 * только нажав «Сохранить» — то есть заполнив форму впустую.
 *
 * Общий для обзора «Интеграции» и раздела «Подключение мессенджеров»
 * (спека 2026-09-12, Р-М-6): один текст на оба экрана.
 */
export function SecretsKeyNotice({ ready }: { ready: boolean }) {
  if (ready) return null;
  return (
    <div
      role="alert"
      className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg px-4 py-3"
    >
      <span aria-hidden className="mr-1">
        ⚠️
      </span>
      <strong>Сохранение секретов недоступно:</strong> на сервере не задан ключ шифрования (
      <code>APP_ENCRYPTION_KEY</code>). Несекретные поля сохранить можно, секретные — нет. Задайте
      ключ в конфиге сервера и перезапустите приложение.
    </div>
  );
}
