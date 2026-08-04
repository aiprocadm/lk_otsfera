import { describe, it, expect } from 'vitest';
import { renderToString } from 'react-dom/server';
import React from 'react';
import { TableShell, THead, Th, Tr, Td } from '@/components/ui/table';

function renderFullTable(extra?: {
  shellClassName?: string;
  overflow?: 'hidden' | 'x-auto';
  hover?: boolean;
}) {
  // Незаданные опции не превращаются в `проп: undefined` — ключ просто не
  // передаётся (exactOptionalPropertyTypes различает эти два случая).
  return renderToString(
    React.createElement(
      TableShell,
      {
        ...(extra?.shellClassName !== undefined ? { className: extra.shellClassName } : {}),
        ...(extra?.overflow !== undefined ? { overflow: extra.overflow } : {}),
      },
      React.createElement(THead, null, React.createElement(Th, null, 'Колонка')),
      React.createElement(
        'tbody',
        null,
        React.createElement(
          Tr,
          { ...(extra?.hover !== undefined ? { hover: extra.hover } : {}) },
          React.createElement(Td, null, 'Ячейка')
        )
      )
    )
  );
}

describe('table primitives', () => {
  it('TableShell renders wrapper + table with baked classes', () => {
    const html = renderFullTable();
    expect(html).toContain('rounded-xl');
    expect(html).toContain('shadow-sm');
    expect(html).toContain('overflow-hidden');
    expect(html).toContain('w-full text-sm');
  });

  it('TableShell overflow="x-auto" swaps overflow class', () => {
    const html = renderFullTable({ overflow: 'x-auto' });
    expect(html).toContain('overflow-x-auto');
    expect(html).not.toContain('overflow-hidden');
  });

  it('TableShell merges caller className (hidden md:block for responsive tables)', () => {
    const html = renderFullTable({ shellClassName: 'hidden md:block' });
    expect(html).toContain('hidden');
    expect(html).toContain('md:block');
  });

  it('Th bakes scope=col and header classes', () => {
    const html = renderFullTable();
    expect(html).toContain('scope="col"');
    expect(html).toContain('font-medium text-gray-600');
    expect(html).toContain('bg-gray-50');
  });

  it('Tr bakes hover + last:border-b-0 by default', () => {
    const html = renderFullTable();
    expect(html).toContain('hover:bg-[#FFF7ED]');
    expect(html).toContain('last:border-b-0');
  });

  it('Tr hover=false omits hover class', () => {
    const html = renderFullTable({ hover: false });
    expect(html).not.toContain('hover:bg-[#FFF7ED]');
  });

  it('Td bakes cell padding', () => {
    const html = renderFullTable();
    expect(html).toContain('px-4 py-2.5');
  });
});
