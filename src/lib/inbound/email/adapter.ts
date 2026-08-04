export type InboundEmailDto = {
  externalId: string;
  from: string;
  subject?: string | undefined;
  text: string;
};

export type InboundEmailFetchResult = {
  messages: InboundEmailDto[];
  cursor: string | null;
};

export interface InboundEmailAdapter {
  fetchNewMessages(cursor: string | null): Promise<InboundEmailFetchResult>;
}
