// Recording double for node-telegram-bot-api, used as the injected `createBot`
// collaborator so tests can drive the real createTelegramBot handler bodies
// without opening a real Telegram connection.

export class FakeTelegramBot {
  constructor() {
    this.onTextHandlers = [];
    this.eventHandlers = {};
    this.sentMessages = [];
    this.sentPhotos = [];
    this.sentVideos = [];
    this.sentDocuments = [];
    this.editedTexts = [];
    this.editedReplyMarkups = [];
    this.answeredCallbacks = [];
    this.pollingStarted = false;
    this.webHookDeleted = false;
    this._nextMessageId = 1;
  }

  onText(regex, handler) {
    this.onTextHandlers.push({ regex, handler });
  }

  on(event, handler) {
    this.eventHandlers[event] = this.eventHandlers[event] || [];
    this.eventHandlers[event].push(handler);
  }

  async deleteWebHook() {
    this.webHookDeleted = true;
  }

  startPolling() {
    this.pollingStarted = true;
  }

  async sendMessage(chatId, text, options) {
    this.sentMessages.push({ chatId, text, options });
    return { message_id: this._nextMessageId++, chat: { id: chatId } };
  }

  async sendPhoto(chatId, buffer, options, fileOptions) {
    this.sentPhotos.push({ chatId, buffer, options, fileOptions });
    return { message_id: this._nextMessageId++, chat: { id: chatId } };
  }

  async sendVideo(chatId, buffer, options, fileOptions) {
    this.sentVideos.push({ chatId, buffer, options, fileOptions });
    return { message_id: this._nextMessageId++, chat: { id: chatId } };
  }

  async sendDocument(chatId, buffer, options, fileOptions) {
    this.sentDocuments.push({ chatId, buffer, options, fileOptions });
    return { message_id: this._nextMessageId++, chat: { id: chatId } };
  }

  async editMessageText(text, options) {
    this.editedTexts.push({ text, options });
    return true;
  }

  async editMessageReplyMarkup(replyMarkup, options) {
    this.editedReplyMarkups.push({ replyMarkup, options });
    return true;
  }

  async answerCallbackQuery(callbackId, options) {
    this.answeredCallbacks.push({ callbackId, options });
    return true;
  }

  /** Test-only helper: drives every registered onText handler whose regex matches `text`. */
  async emitText(text, chatId = 1, extra = {}) {
    const msg = { chat: { id: chatId }, text, ...extra };

    for (const { regex, handler } of this.onTextHandlers) {
      if (regex.test(text)) {
        await handler(msg, text.match(regex));
      }
    }

    return msg;
  }

  /** Test-only helper: drives every registered handler for `event` with `payload`. */
  async emitEvent(event, payload) {
    const handlers = this.eventHandlers[event] || [];

    for (const handler of handlers) {
      await handler(payload);
    }
  }
}

export function makeCallbackQuery({ id = "cb-1", data, chatId = 1, messageId = 1 } = {}) {
  return {
    id,
    data,
    message: { chat: { id: chatId }, message_id: messageId },
  };
}
