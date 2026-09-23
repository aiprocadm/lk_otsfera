import React from 'react';
import Link from 'next/link';

/**
 * Общая страница 404.
 *
 * С `У-263` (прогон сопровождения №37) её видит и тот, кто пришёл по старой
 * закладке или ссылке из давнего письма: шлюзы прежних адресов удалены, и
 * раздел, который переехал, отвечает здесь. Поэтому текст говорит не только
 * «такой страницы нет», но и «раздел мог переехать», а кнопка ведёт в кабинет
 * (`/dashboard` отправляет каждую роль на её главную), где раздел есть в меню.
 */
export default function NotFound() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="text-center max-w-md">
        <div className="text-8xl font-black text-[#F97316] mb-4">404</div>
        <h1 className="text-2xl font-bold text-[#111111] mb-2">Страница не найдена</h1>
        <p className="text-gray-500 mb-6">
          Возможно, раздел переехал: адрес из старой закладки или письма больше не работает.
          Откройте кабинет — нужный раздел есть в меню.
        </p>
        <Link
          href="/dashboard"
          className="inline-block bg-[#111111] hover:bg-[#F97316] text-white font-semibold px-6 py-2.5 rounded-lg text-sm transition-colors"
        >
          В кабинет
        </Link>
      </div>
    </main>
  );
}
