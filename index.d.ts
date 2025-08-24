// TypeScript declarations synchronized with the current public API surface

export type WAState = 'CONNECTED' | 'OPENING' | 'PAIRING' | 'TIMEOUT' | 'CONFLICT' | string;

export interface PairWithPhoneNumberOptions {
  phoneNumber?: string;
  showNotification?: boolean;
  intervalMs?: number;
}

export interface WebVersionCacheOptions {
  type: 'local' | 'remote';
  // For remote, an adapter may provide custom behavior
  [key: string]: any;
}

export interface ClientOptions {
  authStrategy?: BaseAuthStrategy;
  webVersion?: string;
  webVersionCache?: WebVersionCacheOptions;
  authTimeoutMs?: number;
  puppeteer?: any;
  qrMaxRetries?: number;
  takeoverOnConflict?: boolean;
  takeoverTimeoutMs?: number;
  userAgent?: string;
  ffmpegPath?: string;
  bypassCSP?: boolean;
  deviceName?: string;
  browserName?: string;
  proxyAuthentication?: any;
  pairWithPhoneNumber?: PairWithPhoneNumberOptions;
}

export class Client {
  constructor(options?: ClientOptions);
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  logout(): Promise<void>;

  // Pairing
  requestPairingCode(phoneNumber: string, showNotification?: boolean, intervalMs?: number): Promise<string>;

  // Versioning
  getWWebVersion(): Promise<string>;

  // User and state
  /** @deprecated This library is read-only; do not mutate profile data. */
  setDisplayName(displayName: string): Promise<boolean>;
  getState(): Promise<WAState | null>;

  // Search and retrieval
  searchMessages(query: string, options?: { page?: number; limit?: number; chatId?: string }): Promise<Message[]>;

  // Chats
  getChats(): Promise<Array<Chat | Channel>>;
  getChatById(chatId: string): Promise<Chat | Channel | undefined>;

  // Contacts
  getContacts(): Promise<Contact[]>;
  getContactById(contactId: string): Promise<Contact>;

  // Messages
  getMessageById(messageId: string): Promise<Message | null>;
  getPinnedMessages(chatId: string): Promise<Message[]>;

  // Invites and groups
  getInviteInfo(inviteCode: string): Promise<any>;

  // Profile
  getProfilePicUrl(contactId: string): Promise<string | undefined>;

  // Utilities
  getCommonGroups(contactId: string): Promise<string[]>;

  // Labels and broadcasts
  getLabels(): Promise<any[]>;
  getBroadcasts(): Promise<any[]>;
  getLabelById(labelId: string): Promise<any>;
  getChatLabels(chatId: string): Promise<any[]>;
  getChatsByLabelId(labelId: string): Promise<Array<Chat | Channel>>;

  // Background sync
  setBackgroundSync(flag: boolean): Promise<boolean>;

  // Device info
  getContactDeviceCount(userId: string): Promise<number>;

  // History sync
  syncHistory(chatId: string): Promise<boolean>;

  // Calls/events
  createCallLink(startTime: Date, callType: 'video' | 'voice'): Promise<string>;
  sendResponseToScheduledEvent(response: 0 | 1 | 2 | 3, eventMessageId: string): Promise<boolean>;

  // Addressbook (mutative)
  /** @deprecated This library is read-only; do not mutate the addressbook. */
  saveOrEditAddressbookContact(phoneNumber: string, firstName: string, lastName: string, syncToAddressbook?: boolean): Promise<any>;
  /** @deprecated This library is read-only; do not mutate the addressbook. */
  deleteAddressbookContact(phoneNumber: string): Promise<void>;

  // IDs
  getNumberId(number: string): Promise<any | null>;
  getFormattedNumber(number: string): Promise<string>;
  getCountryCode(number: string): Promise<string>;

  // LID/PN map
  getContactLidAndPhone(userIds: string[]): Promise<Array<{ lid: string; pn: string }>>;

  // Channels
  searchChannels(searchOptions?: {
    searchText?: string;
    countryCodes?: string[];
    skipSubscribedNewsletters?: boolean;
    view?: 0 | 1 | 2 | 3;
    limit?: number;
  }): Promise<Channel[]>;

  // Events (generic signature to avoid drift)
  on(event: string, listener: (...args: any[]) => void): this;
}

export class BaseAuthStrategy {
  constructor();
  setup(client: Client): void | Promise<void>;
  beforeBrowserInitialized(): void | Promise<void>;
  afterBrowserInitialized(): void | Promise<void>;
  onAuthenticationNeeded(): Promise<{ failed: boolean; restart: boolean; failureEventPayload?: any }>;
  getAuthEventPayload(): Promise<any> | any;
  afterAuthReady(): void | Promise<void>;
  disconnect(): void | Promise<void>;
  destroy(): void | Promise<void>;
  logout(): void | Promise<void>;
}

export class LocalAuth extends BaseAuthStrategy {
  constructor(options?: { clientId?: string; dataPath?: string; rmMaxRetries?: number });
}

export class RemoteAuth extends BaseAuthStrategy {
  constructor(options?: { clientId?: string; dataPath?: string; store: any; backupSyncIntervalMs: number; rmMaxRetries?: number });
}

export class Base {
  id: any;
}

export class Chat extends Base { [key: string]: any }
export class GroupChat extends Chat { [key: string]: any }
export class Channel extends Chat { [key: string]: any }
export class Message extends Base { [key: string]: any }
export class Contact extends Base { [key: string]: any }

export interface WebCache {
  // Minimal API used by Client.js
  resolve(version?: string): Promise<string | null>;
  persist(content: string, version: string): Promise<void>;

  // Optional KV API
  get?(key: string): Promise<any>;
  set?(key: string, value: any, ttlMs?: number): Promise<void>;
  delete?(key: string): Promise<void>;
  clear?(): Promise<void>;
}

export class LocalWebCache implements WebCache {
  resolve(version?: string): Promise<string | null>;
  persist(content: string, version: string): Promise<void>;
  get?(key: string): Promise<any>;
  set?(key: string, value: any, ttlMs?: number): Promise<void>;
  delete?(key: string): Promise<void>;
  clear?(): Promise<void>;
}

export class RemoteWebCache implements WebCache {
  constructor(adapter: any);
  resolve(version?: string): Promise<string | null>;
  persist(content: string, version: string): Promise<void>;
  get?(key: string): Promise<any>;
  set?(key: string, value: any, ttlMs?: number): Promise<void>;
  delete?(key: string): Promise<void>;
  clear?(): Promise<void>;
}

export const Constants: {
  WhatsWebURL: string;
  DefaultOptions: Record<string, any>;
  Events: Record<string, string>;
  WAState: Record<string, string>;
  WHATSAPP_URL: string; // back-compat
  DEFAULT_USER_AGENT: string; // back-compat
};

export const util: {
  Constants: typeof Constants;
  Util: {
    sleep(ms: number): Promise<void>;
    defer(): { promise: Promise<any>; resolve: (value?: any) => void; reject: (reason?: any) => void };
  };
  Puppeteer: {
    PuppeteerDriver: any;
    exposeFunctionIfAbsent(page: any, name: string, fn: (...args: any[]) => any): Promise<void>;
  };
};

export const factories: {
  ChatFactory: { create(client: Client, data: any): Chat | GroupChat | Channel };
  ContactFactory: { create(client: Client, data: any): Contact };
};

export const structures: {
  Base: typeof Base;
  Chat: typeof Chat;
  GroupChat: typeof GroupChat;
  Channel: typeof Channel;
  Message: typeof Message;
  Contact: typeof Contact;
};
