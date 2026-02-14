import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PushNotificationService, urlBase64ToUint8Array } from '../pushService';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

vi.mock('../apiClient', () => ({
  getApiClient: () => ({
    get: mockGet,
    post: mockPost,
    delete: mockDelete,
  }),
}));

// ---------------------------------------------------------------------------
// Browser API helpers
// ---------------------------------------------------------------------------

function createMockPushSubscription(overrides?: Partial<PushSubscription>): PushSubscription {
  return {
    endpoint: 'https://push.example.com/sub/abc123',
    expirationTime: null,
    options: {} as PushSubscriptionOptions,
    getKey: vi.fn(),
    toJSON: () => ({
      endpoint: 'https://push.example.com/sub/abc123',
      keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
    }),
    unsubscribe: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as PushSubscription;
}

function createMockPushManager(sub: PushSubscription | null = null): PushManager {
  return {
    getSubscription: vi.fn().mockResolvedValue(sub),
    subscribe: vi.fn().mockResolvedValue(sub),
    permissionState: vi.fn().mockResolvedValue('granted'),
  } as unknown as PushManager;
}

function createMockRegistration(
  pushManager?: PushManager,
): ServiceWorkerRegistration {
  return {
    pushManager: pushManager ?? createMockPushManager(),
    active: {} as ServiceWorker,
  } as unknown as ServiceWorkerRegistration;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const ORIGINAL_NAVIGATOR_SERVICE_WORKER = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
const ORIGINAL_WINDOW_PUSH_MANAGER = Object.getOwnPropertyDescriptor(window, 'PushManager');
const ORIGINAL_WINDOW_NOTIFICATION = Object.getOwnPropertyDescriptor(window, 'Notification');

function restoreGlobalProperty(target: object, key: string, original?: PropertyDescriptor) {
  if (original) {
    Object.defineProperty(target, key, original);
    return;
  }
  // If there was no own property originally, remove our stub to fall back
  // to the environment default (prototype chain).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (target as any)[key];
}

describe('PushNotificationService', () => {
  let service: PushNotificationService;

  beforeEach(() => {
    service = new PushNotificationService();
    mockGet.mockReset();
    mockPost.mockReset();
    mockDelete.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();

    restoreGlobalProperty(navigator, 'serviceWorker', ORIGINAL_NAVIGATOR_SERVICE_WORKER);
    restoreGlobalProperty(window, 'PushManager', ORIGINAL_WINDOW_PUSH_MANAGER);
    restoreGlobalProperty(window, 'Notification', ORIGINAL_WINDOW_NOTIFICATION);
  });

  // -----------------------------------------------------------------------
  // isSupported
  // -----------------------------------------------------------------------

  describe('isSupported', () => {
    it('returns true when serviceWorker, PushManager, and Notification exist', () => {
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { ready: Promise.resolve({}) },
        configurable: true,
      });
      Object.defineProperty(window, 'PushManager', {
        value: class {},
        configurable: true,
      });
      Object.defineProperty(window, 'Notification', {
        value: { permission: 'default', requestPermission: vi.fn() },
        configurable: true,
      });

      expect(service.isSupported()).toBe(true);
    });

    it('returns false when PushManager is missing', () => {
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { ready: Promise.resolve({}) },
        configurable: true,
      });
      Object.defineProperty(window, 'Notification', {
        value: { permission: 'default', requestPermission: vi.fn() },
        configurable: true,
      });

      // `isSupported()` uses `'PushManager' in window`, so the property must
      // be removed entirely (not just set to undefined).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).PushManager;

      expect(service.isSupported()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // getPermission
  // -----------------------------------------------------------------------

  describe('getPermission', () => {
    it('returns "unsupported" when push is not supported', () => {
      vi.spyOn(service, 'isSupported').mockReturnValue(false);
      expect(service.getPermission()).toBe('unsupported');
    });

    it('returns current Notification.permission', () => {
      vi.spyOn(service, 'isSupported').mockReturnValue(true);
      Object.defineProperty(window, 'Notification', {
        value: { permission: 'granted' },
        configurable: true,
      });

      expect(service.getPermission()).toBe('granted');
    });
  });

  // -----------------------------------------------------------------------
  // requestPermission
  // -----------------------------------------------------------------------

  describe('requestPermission', () => {
    it('returns "unsupported" when not supported', async () => {
      vi.spyOn(service, 'isSupported').mockReturnValue(false);
      expect(await service.requestPermission()).toBe('unsupported');
    });

    it('delegates to Notification.requestPermission', async () => {
      vi.spyOn(service, 'isSupported').mockReturnValue(true);
      const requestPermission = vi.fn().mockResolvedValue('granted');
      Object.defineProperty(window, 'Notification', {
        value: { permission: 'default', requestPermission },
        configurable: true,
      });

      const result = await service.requestPermission();
      expect(result).toBe('granted');
      expect(requestPermission).toHaveBeenCalledOnce();
    });
  });

  // -----------------------------------------------------------------------
  // getRegistration
  // -----------------------------------------------------------------------

  describe('getRegistration', () => {
    it('returns null when unsupported', async () => {
      vi.spyOn(service, 'isSupported').mockReturnValue(false);
      expect(await service.getRegistration()).toBeNull();
    });

    it('waits for navigator.serviceWorker.ready and caches', async () => {
      vi.spyOn(service, 'isSupported').mockReturnValue(true);
      const reg = createMockRegistration();
      Object.defineProperty(navigator, 'serviceWorker', {
        value: { ready: Promise.resolve(reg) },
        configurable: true,
      });

      const first = await service.getRegistration();
      const second = await service.getRegistration();
      expect(first).toBe(reg);
      expect(second).toBe(reg); // cached
    });
  });

  // -----------------------------------------------------------------------
  // subscribe
  // -----------------------------------------------------------------------

  describe('subscribe', () => {
    it('returns false when permission is denied', async () => {
      vi.spyOn(service, 'requestPermission').mockResolvedValue('denied');
      expect(await service.subscribe()).toBe(false);
    });

    it('returns false when no registration available', async () => {
      vi.spyOn(service, 'requestPermission').mockResolvedValue('granted');
      vi.spyOn(service, 'getRegistration').mockResolvedValue(null);
      expect(await service.subscribe()).toBe(false);
    });

    it('returns false when VAPID key is null', async () => {
      vi.spyOn(service, 'requestPermission').mockResolvedValue('granted');
      vi.spyOn(service, 'getRegistration').mockResolvedValue(
        createMockRegistration(),
      );
      mockGet.mockResolvedValue({ publicKey: null });

      expect(await service.subscribe()).toBe(false);
      expect(mockGet).toHaveBeenCalledWith('/api/push/vapid-public-key');
    });

    it('subscribes end-to-end and registers on relay', async () => {
      const sub = createMockPushSubscription();
      const pm = createMockPushManager(sub);
      const reg = createMockRegistration(pm);

      vi.spyOn(service, 'requestPermission').mockResolvedValue('granted');
      vi.spyOn(service, 'getRegistration').mockResolvedValue(reg);

      // Use a realistic base64url-encoded VAPID key (65 bytes → 88 chars)
      const vapidKey =
        'BNq5cBfD1Wqc0YxQw6Tz0FheR40PqZHBGGQ1UyFa1gX6LPSaIBV8aMpIJjCzG1D1Wkq_pHeRr6a0uAVtjOiU2k';

      mockGet.mockResolvedValue({ publicKey: vapidKey });
      mockPost.mockResolvedValue(undefined);

      const result = await service.subscribe();

      expect(result).toBe(true);
      expect(mockGet).toHaveBeenCalledWith('/api/push/vapid-public-key');
      expect(pm.subscribe).toHaveBeenCalledWith({
        userVisibleOnly: true,
        applicationServerKey: expect.any(Uint8Array),
      });
      expect(mockPost).toHaveBeenCalledWith('/api/push/subscribe', {
        subscription: {
          endpoint: 'https://push.example.com/sub/abc123',
          keys: { p256dh: 'test-p256dh', auth: 'test-auth' },
        },
      });
    });

    it('returns false and logs on unexpected error', async () => {
      vi.spyOn(service, 'requestPermission').mockResolvedValue('granted');
      vi.spyOn(service, 'getRegistration').mockResolvedValue(
        createMockRegistration(),
      );
      mockGet.mockRejectedValue(new Error('Network error'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(await service.subscribe()).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[Push] Subscribe failed:',
        expect.any(Error),
      );
    });
  });

  // -----------------------------------------------------------------------
  // unsubscribe
  // -----------------------------------------------------------------------

  describe('unsubscribe', () => {
    it('returns true when already unsubscribed (no existing subscription)', async () => {
      vi.spyOn(service, 'getRegistration').mockResolvedValue(
        createMockRegistration(createMockPushManager(null)),
      );

      expect(await service.unsubscribe()).toBe(true);
    });

    it('unsubscribes and notifies relay', async () => {
      const sub = createMockPushSubscription();
      const pm = createMockPushManager(sub);
      const reg = createMockRegistration(pm);
      vi.spyOn(service, 'getRegistration').mockResolvedValue(reg);
      mockDelete.mockResolvedValue(undefined);

      expect(await service.unsubscribe()).toBe(true);
      expect(sub.unsubscribe).toHaveBeenCalled();
      expect(mockDelete).toHaveBeenCalledWith('/api/push/unsubscribe', {
        endpoint: 'https://push.example.com/sub/abc123',
      });
    });

    it('succeeds even when relay DELETE fails', async () => {
      const sub = createMockPushSubscription();
      const pm = createMockPushManager(sub);
      const reg = createMockRegistration(pm);
      vi.spyOn(service, 'getRegistration').mockResolvedValue(reg);
      mockDelete.mockRejectedValue(new Error('relay down'));

      expect(await service.unsubscribe()).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // isSubscribed
  // -----------------------------------------------------------------------

  describe('isSubscribed', () => {
    it('returns false when no registration', async () => {
      vi.spyOn(service, 'getRegistration').mockResolvedValue(null);
      expect(await service.isSubscribed()).toBe(false);
    });

    it('returns true when subscription exists', async () => {
      const sub = createMockPushSubscription();
      const pm = createMockPushManager(sub);
      vi.spyOn(service, 'getRegistration').mockResolvedValue(
        createMockRegistration(pm),
      );

      expect(await service.isSubscribed()).toBe(true);
    });

    it('returns false when subscription is null', async () => {
      const pm = createMockPushManager(null);
      vi.spyOn(service, 'getRegistration').mockResolvedValue(
        createMockRegistration(pm),
      );

      expect(await service.isSubscribed()).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// urlBase64ToUint8Array
// ---------------------------------------------------------------------------

describe('urlBase64ToUint8Array', () => {
  it('converts a url-safe base64 string to Uint8Array', () => {
    // "Hello" in base64 is "SGVsbG8=", url-safe is "SGVsbG8"
    const result = urlBase64ToUint8Array('SGVsbG8');
    expect(result).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(result)).toBe('Hello');
  });

  it('handles padding correctly', () => {
    // "Hi" in base64 is "SGk="
    const result = urlBase64ToUint8Array('SGk');
    expect(new TextDecoder().decode(result)).toBe('Hi');
  });

  it('converts url-safe chars (- and _) back to + and /', () => {
    // Standard base64 "a+b/" → url-safe "a-b_"
    const result = urlBase64ToUint8Array('a-b_');
    const standardResult = Uint8Array.from(atob('a+b/'), (c) => c.charCodeAt(0));
    expect(result).toEqual(standardResult);
  });
});
