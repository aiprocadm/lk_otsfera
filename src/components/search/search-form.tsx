import React from 'react';
import { Button, Input } from '@/components/ui';

// Server component — чистая HTML `<form method="get">`: submit становится
// навигацией на `${action}?q=...` (идиома фильтров списков, без клиентского JS).
export function SearchForm({ action, initialQuery }: { action: string; initialQuery?: string }) {
  return (
    <form method="get" action={action} className="flex gap-2" role="search">
      <Input
        type="search"
        name="q"
        defaultValue={initialQuery ?? ''}
        placeholder="Заказы, организации, заявки, задачи, документы…"
        aria-label="Поисковый запрос"
        autoFocus
        className="flex-1"
      />
      <Button type="submit">Найти</Button>
    </form>
  );
}
