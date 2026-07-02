export * from './types';
export * from './preferences';
export { emailChannel } from './email';
export { telegramChannel } from './telegram';
export { maxChannel } from './max';
export { whatsappChannel } from './whatsapp';
export { getChannels } from './registry';
export { deliverToRecipient, type DeliverOptions, type DeliveryResults } from './deliver';
export {
  dispatchToRecipient,
  notificationJobId,
  type DispatchOptions,
  type DispatchOutcome,
} from './dispatch';
