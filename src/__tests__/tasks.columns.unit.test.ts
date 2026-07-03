import { describe, it, expect } from 'vitest';
import { DEFAULT_TASK_COLUMNS, columnForTask } from '@/lib/tasks/columns';

describe('DEFAULT_TASK_COLUMNS', () => {
  it('4 колонки: todo/in_progress/review/done, позиции 0..3', () => {
    expect(DEFAULT_TASK_COLUMNS.map((c) => c.statusAnchor)).toEqual(['todo', 'in_progress', 'review', 'done']);
    expect(DEFAULT_TASK_COLUMNS.map((c) => c.position)).toEqual([0, 1, 2, 3]);
  });

  it('единственная done-колонка — последняя (isDoneColumn)', () => {
    expect(DEFAULT_TASK_COLUMNS.filter((c) => c.isDoneColumn).map((c) => c.statusAnchor)).toEqual(['done']);
  });

  it('синтетические id по образцу default:<anchor>', () => {
    expect(DEFAULT_TASK_COLUMNS.map((c) => c.id)).toEqual([
      'default:todo',
      'default:in_progress',
      'default:review',
      'default:done'
    ]);
  });
});

describe('columnForTask', () => {
  const columns = DEFAULT_TASK_COLUMNS.map((c) => ({ ...c }));

  it('явный columnId, существующий в наборе', () => {
    expect(columnForTask(columns, { status: 'todo', columnId: 'default:review' })?.id).toBe('default:review');
  });

  it('columnId отсутствует в наборе → колонка по якорю status', () => {
    expect(columnForTask(columns, { status: 'in_progress', columnId: 'stale-id' })?.id).toBe('default:in_progress');
  });

  it('columnId=null → колонка по якорю status', () => {
    expect(columnForTask(columns, { status: 'done', columnId: null })?.id).toBe('default:done');
  });

  it('нет совпадения по статусу и нет columnId → undefined', () => {
    const noDone = columns.filter((c) => c.statusAnchor !== 'done');
    expect(columnForTask(noDone, { status: 'done', columnId: null })).toBeUndefined();
  });
});
