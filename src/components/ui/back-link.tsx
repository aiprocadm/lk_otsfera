import React from 'react';
import Link from 'next/link';

/** Единая «назад»-ссылка детальных страниц. Текст — «Все <раздел во мн.ч.>». */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className='inline-block text-sm text-gray-500 hover:text-[#F97316] transition-colors'>
      {`← ${label}`}
    </Link>
  );
}
