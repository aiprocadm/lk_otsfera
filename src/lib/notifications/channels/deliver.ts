/**
 * Inline-доставка по включённым каналам получателя (D1).
 *
 * Каждый канал — в собственном try/catch: ошибка одного канала не роняет
 * остальные и не поднимается к вызывающему (best-effort; in-app
 * Notification-строка уже создана и остаётся источником истины).
 */
import { getChannels } from './registry';
import type { ChannelKey, ChannelPayload, ChannelRecipient, ChannelSendResult } from './types';

export type DeliveryResults = Partial<Record<ChannelKey, ChannelSendResult>>;

export type DeliverOptions = {
  /** Сузить веер до перечисленных каналов (например, ops-алерты — только email). */
  channels?: ChannelKey[];
};

export async function deliverToRecipient(
  user: ChannelRecipient,
  payload: ChannelPayload,
  opts?: DeliverOptions
): Promise<DeliveryResults> {
  const results: DeliveryResults = {};
  for (const channel of getChannels()) {
    if (opts?.channels && !opts.channels.includes(channel.key)) continue;
    if (!channel.isEnabledFor(user)) continue;
    try {
      results[channel.key] = await channel.send(user, payload);
    } catch (err) {
      results[channel.key] = {
        status: 'failed',
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
  return results;
}
