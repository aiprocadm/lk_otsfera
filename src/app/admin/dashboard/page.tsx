export default function AdminDashboardPage() {
  return (
    <div className='space-y-6'>
      <div>
        <h1 className='text-2xl font-bold text-[#111111]'>Кабинет администратора</h1>
        <p className='text-gray-500 mt-1'>Управление платформой, заказами, документами и сообщениями.</p>
      </div>
      <div className='grid gap-4 md:grid-cols-3'>
        <div className='bg-[#F97316] rounded-xl p-5 text-white'>
          <div className='text-orange-100 text-xs font-medium uppercase tracking-wider mb-2'>Роль</div>
          <div className='text-2xl font-bold'>Администратор</div>
        </div>
        <div className='bg-white border border-gray-200 rounded-xl p-5'>
          <div className='text-gray-500 text-xs font-medium uppercase tracking-wider mb-2'>Доступ</div>
          <div className='text-2xl font-bold text-[#111111]'>Полный</div>
        </div>
        <div className='bg-white border border-gray-200 rounded-xl p-5'>
          <div className='text-gray-500 text-xs font-medium uppercase tracking-wider mb-2'>Статус</div>
          <div className='flex items-center gap-2'>
            <span className='w-2 h-2 rounded-full bg-green-500' />
            <span className='text-lg font-bold text-[#111111]'>Активен</span>
          </div>
        </div>
      </div>
    </div>
  );
}
