import { getApiClient } from './apiClient';

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';

/**
 * Manages Web Push notification lifecycle:
 * permission checks, subscription via the Push API,
 * VAPID key retrieval, and relay registration.
 */
export class PushNotificationService {
  private registration: ServiceWorkerRegistration | null = null;
  private subscription: PushSubscription | null = null;

  /** Check if push notifications are supported in this browser. */
  isSupported(): boolean {
    return (
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  /** Get the current notification permission state. */
  getPermission(): PushPermission {
    if (!this.isSupported()) return 'unsupported';
    return Notification.permission as PushPermission;
  }

  /** Request notification permission from the user. */
  async requestPermission(): Promise<PushPermission> {
    if (!this.isSupported()) return 'unsupported';
    const result = await Notification.requestPermission();
    return result as PushPermission;
  }

  /** Get (and cache) the active service worker registration. */
  async getRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (this.registration) return this.registration;
    if (!this.isSupported()) return null;
    this.registration = await navigator.serviceWorker.ready;
    return this.registration;
  }

  /**
   * Subscribe to push notifications end-to-end:
   * 1. Request permission
   * 2. Fetch VAPID public key from relay
   * 3. Subscribe via PushManager
   * 4. Send subscription to relay
   *
   * Returns `true` on success, `false` on any failure.
   */
  async subscribe(): Promise<boolean> {
    const permission = await this.requestPermission();
    if (permission !== 'granted') return false;

    const reg = await this.getRegistration();
    if (!reg) return false;

    try {
      const api = getApiClient();

      // Fetch VAPID public key from relay
      const { publicKey } = await api.get<{ publicKey: string | null }>(
        '/api/push/vapid-public-key',
      );
      if (!publicKey) {
        console.error('[Push] Server has no VAPID key configured');
        return false;
      }

      const applicationServerKey = urlBase64ToUint8Array(publicKey) as BufferSource;

      // Subscribe via the Push API
      this.subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      // Register subscription on the relay
      const subJson = this.subscription.toJSON();
      await api.post('/api/push/subscribe', {
        subscription: {
          endpoint: subJson.endpoint,
          keys: {
            p256dh: subJson.keys?.p256dh,
            auth: subJson.keys?.auth,
          },
        },
      });

      return true;
    } catch (error) {
      console.error('[Push] Subscribe failed:', error);
      return false;
    }
  }

  /**
   * Unsubscribe from push notifications:
   * removes the browser subscription and notifies the relay.
   */
  async unsubscribe(): Promise<boolean> {
    if (!this.subscription) {
      const reg = await this.getRegistration();
      if (reg) {
        this.subscription = await reg.pushManager.getSubscription();
      }
    }

    if (!this.subscription) return true; // already unsubscribed

    const endpoint = this.subscription.endpoint;

    try {
      await this.subscription.unsubscribe();
    } catch {
      // best effort — the browser subscription may already be gone
    }
    this.subscription = null;

    // Notify relay (best effort)
    try {
      const api = getApiClient();
      await api.delete('/api/push/unsubscribe', { endpoint });
    } catch {
      // best effort
    }

    return true;
  }

  /** Check whether the browser currently has an active push subscription. */
  async isSubscribed(): Promise<boolean> {
    const reg = await this.getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return sub !== null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a URL-safe base64 string to a Uint8Array.
 * Required by `PushManager.subscribe({ applicationServerKey })`.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i++) {
    view[i] = rawData.charCodeAt(i);
  }
  return view;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: PushNotificationService | null = null;

/** Get the singleton PushNotificationService instance. */
export function getPushService(): PushNotificationService {
  if (!instance) instance = new PushNotificationService();
  return instance;
}

// Visible for testing
export { urlBase64ToUint8Array };
