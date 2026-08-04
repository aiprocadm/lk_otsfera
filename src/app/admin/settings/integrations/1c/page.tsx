import { redirect } from 'next/navigation';

/** Корень подраздела «Обмен с 1С» — открываем первую вкладку. */
export default function AdminOneCIndexPage() {
  redirect('/admin/settings/integrations/1c/excel');
}
