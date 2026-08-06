import { redirect } from 'next/navigation';

/** Корень подраздела «Обмен с 1С» руководителя — открываем первую вкладку. */
export default function LeaderOneCIndexPage() {
  redirect('/leader/settings/integrations/1c/excel');
}
