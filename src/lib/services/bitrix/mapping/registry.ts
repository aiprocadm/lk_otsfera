/**
 * Реестр «что уже есть и что появится» на время одного прогона.
 *
 * Предпросмотр обязан считать так же, как посчитает применение. Но во время
 * сухого прогона организаций ещё нет в базе, и сделка, сославшись на них,
 * честно получила бы «нет организации» — предпросмотр показал бы картину,
 * которой не будет. Поэтому реестр помнит и найденные строки ЛК, и те, что
 * конвейер ЗАПЛАНИРОВАЛ создать: у последних вместо настоящего идентификатора
 * стоит метка `planned:*`.
 *
 * Метка наружу не уходит: в `live` writer заменяет её настоящим id сразу после
 * создания строки (PR-4), а в `shadow` она нужна лишь для связности счётчиков.
 */
export class BitrixRegistry {
  private readonly maps = new Map<string, Map<string, string>>();

  private bucket(entity: string): Map<string, string> {
    let bucket = this.maps.get(entity);
    if (!bucket) {
      bucket = new Map<string, string>();
      this.maps.set(entity, bucket);
    }
    return bucket;
  }

  set(entity: string, bitrixId: string, id: string): void {
    this.bucket(entity).set(bitrixId, id);
  }

  /** Запомнить, что строка появится: до записи у неё нет настоящего id. */
  plan(entity: string, bitrixId: string): string {
    const id = plannedId(entity, bitrixId);
    this.bucket(entity).set(bitrixId, id);
    return id;
  }

  get(entity: string, bitrixId: string): string | undefined {
    return this.bucket(entity).get(bitrixId);
  }

  size(entity: string): number {
    return this.bucket(entity).size;
  }

  /** Все идентификаторы Битрикса этой сущности — ими спрашиваем комментарии и файлы. */
  keys(entity: string): string[] {
    return [...this.bucket(entity).keys()];
  }
}

export function plannedId(entity: string, bitrixId: string): string {
  return `planned:${entity}:${bitrixId}`;
}

export function isPlanned(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('planned:');
}
