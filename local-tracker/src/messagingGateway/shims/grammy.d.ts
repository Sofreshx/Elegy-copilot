import type { UserFromGetMe } from 'grammy/types';

export declare class Bot {
  constructor(token: string);
  botInfo?: UserFromGetMe;
  api: {
    getMe(): Promise<UserFromGetMe>;
    setMyCommands(commands: Array<{ command: string; description: string }>): Promise<unknown>;
    sendMessage(
      chatId: number,
      text: string,
      options?: { reply_markup?: unknown },
    ): Promise<{ message_id: number }>;
    editMessageText(
      chatId: number,
      messageId: number,
      text: string,
      options?: { reply_markup?: unknown },
    ): Promise<unknown>;
    answerCallbackQuery(
      callbackQueryId: string,
      options?: { text?: string },
    ): Promise<unknown>;
  };
}
