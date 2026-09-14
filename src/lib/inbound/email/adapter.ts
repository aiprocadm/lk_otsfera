export type InboundEmailDto = {
  externalId: string;
  from: string;
  subject?: string | undefined;
  text: string;
  /**
   * `Message-ID` письма (`У-205`). По нему ответ менеджера сшивается с
   * перепиской у клиента. Сервер может его не прислать — тогда null, и ответ
   * уйдёт отдельным письмом.
   */
  messageId?: string | null | undefined;
};

export type InboundEmailFetchResult = {
  messages: InboundEmailDto[];
  cursor: string | null;
};

export interface InboundEmailAdapter {
  fetchNewMessages(cursor: string | null): Promise<InboundEmailFetchResult>;
}
