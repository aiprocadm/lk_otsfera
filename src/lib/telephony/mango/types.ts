/**
 * Контракт адаптера Mango Office. Вынесен из index.ts, чтобы адаптеры не
 * импортировали barrel (цикл adapter → index → adapter, правило no-circular).
 */
export interface MangoAdapter {
  fetchRecording(recordingId: string): Promise<{ buffer: Buffer; contentType: string } | null>;
  requestStats(range: { from: string; to: string }): Promise<{ key: string }>;
  fetchStatsResult(key: string): Promise<{ ready: boolean; rows: unknown[] }>;
  initiateCallback(input: {
    fromInternal: string;
    toNumber: string;
  }): Promise<{ commandId: string }>;
}
