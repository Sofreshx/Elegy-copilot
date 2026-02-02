/**
 * Reminders service for tracking stale ideas and scheduling notifications.
 * Uses IndexedDB for persistence and the Notification API for push notifications.
 */

export type ReminderInterval = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'never';

export interface ReminderRule {
  id: string;
  enabled: boolean;
  interval: ReminderInterval;
  staleDays: number; // Days without update before considered stale
  statuses: string[]; // Only remind for these statuses (e.g., 'draft', 'planned')
  priorities: string[]; // Only remind for these priorities
}

export interface ReminderSettings {
  enabled: boolean;
  rules: ReminderRule[];
  quietHoursStart: number; // Hour (0-23) to stop notifications
  quietHoursEnd: number; // Hour (0-23) to resume notifications
  pushEnabled: boolean;
  lastChecked: number | null;
}

export interface Reminder {
  id: string;
  ideaId: string;
  ideaTitle: string;
  reason: string;
  createdAt: number;
  snoozedUntil: number | null;
  dismissed: boolean;
}

// Default settings
const DEFAULT_SETTINGS: ReminderSettings = {
  enabled: true,
  rules: [
    {
      id: 'default-stale',
      enabled: true,
      interval: 'weekly',
      staleDays: 7,
      statuses: ['draft', 'refining'],
      priorities: ['high', 'medium'],
    },
    {
      id: 'high-priority',
      enabled: true,
      interval: 'daily',
      staleDays: 3,
      statuses: ['planned', 'ready'],
      priorities: ['high'],
    },
  ],
  quietHoursStart: 22, // 10 PM
  quietHoursEnd: 8, // 8 AM
  pushEnabled: true,
  lastChecked: null,
};

// Storage keys
const SETTINGS_KEY = 'reminder_settings';

// IndexedDB setup
const DB_NAME = 'reminders';
const DB_VERSION = 1;

let db: IDBDatabase | null = null;

async function getDb(): Promise<IDBDatabase> {
  if (db) return db;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = (event.target as IDBOpenDBRequest).result;

      if (!database.objectStoreNames.contains('reminders')) {
        const store = database.createObjectStore('reminders', { keyPath: 'id' });
        store.createIndex('ideaId', 'ideaId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
      }

      if (!database.objectStoreNames.contains('analytics')) {
        database.createObjectStore('analytics', { keyPath: 'id' });
      }
    };
  });
}

class RemindersService {
  /**
   * Get reminder settings
   */
  getSettings(): ReminderSettings {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) return DEFAULT_SETTINGS;

    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    } catch {
      return DEFAULT_SETTINGS;
    }
  }

  /**
   * Save reminder settings
   */
  saveSettings(settings: Partial<ReminderSettings>): void {
    const current = this.getSettings();
    const updated = { ...current, ...settings };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  }

  /**
   * Request push notification permission
   */
  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      console.warn('Notifications not supported');
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission === 'denied') {
      return false;
    }

    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }

  /**
   * Check if currently in quiet hours
   */
  isQuietHours(): boolean {
    const settings = this.getSettings();
    const now = new Date();
    const hour = now.getHours();

    if (settings.quietHoursStart <= settings.quietHoursEnd) {
      // Same day (e.g., 8 AM to 10 PM)
      return hour < settings.quietHoursEnd || hour >= settings.quietHoursStart;
    } else {
      // Spans midnight (e.g., 10 PM to 8 AM)
      return hour >= settings.quietHoursStart || hour < settings.quietHoursEnd;
    }
  }

  /**
   * Check ideas and create reminders for stale ones
   */
  async checkIdeas(ideas: { id: string; title: string; status: string; priority: string; updatedAt: number }[]): Promise<Reminder[]> {
    const settings = this.getSettings();
    if (!settings.enabled) return [];

    const now = Date.now();
    const reminders: Reminder[] = [];

    for (const rule of settings.rules) {
      if (!rule.enabled) continue;

      const staleThreshold = now - rule.staleDays * 24 * 60 * 60 * 1000;

      for (const idea of ideas) {
        // Check if idea matches rule criteria
        if (!rule.statuses.includes(idea.status)) continue;
        if (!rule.priorities.includes(idea.priority)) continue;

        // Check if idea is stale
        if (idea.updatedAt > staleThreshold) continue;

        // Check if reminder already exists and not snoozed
        const existing = await this.getReminderForIdea(idea.id);
        if (existing && !existing.dismissed) {
          if (existing.snoozedUntil && existing.snoozedUntil > now) {
            continue; // Still snoozed
          }
        }

        // Create new reminder
        const reminder: Reminder = {
          id: crypto.randomUUID(),
          ideaId: idea.id,
          ideaTitle: idea.title,
          reason: `No updates for ${rule.staleDays}+ days`,
          createdAt: now,
          snoozedUntil: null,
          dismissed: false,
        };

        await this.saveReminder(reminder);
        reminders.push(reminder);
      }
    }

    // Update last checked
    this.saveSettings({ lastChecked: now });

    return reminders;
  }

  /**
   * Get reminder for a specific idea
   */
  async getReminderForIdea(ideaId: string): Promise<Reminder | null> {
    const database = await getDb();

    return new Promise((resolve, reject) => {
      const tx = database.transaction('reminders', 'readonly');
      const store = tx.objectStore('reminders');
      const index = store.index('ideaId');
      const request = index.get(ideaId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  /**
   * Save a reminder
   */
  async saveReminder(reminder: Reminder): Promise<void> {
    const database = await getDb();

    return new Promise((resolve, reject) => {
      const tx = database.transaction('reminders', 'readwrite');
      const store = tx.objectStore('reminders');
      const request = store.put(reminder);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Get all active reminders
   */
  async getActiveReminders(): Promise<Reminder[]> {
    const database = await getDb();
    const now = Date.now();

    return new Promise((resolve, reject) => {
      const tx = database.transaction('reminders', 'readonly');
      const store = tx.objectStore('reminders');
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const all = request.result as Reminder[];
        const active = all.filter(
          (r) => !r.dismissed && (!r.snoozedUntil || r.snoozedUntil <= now)
        );
        resolve(active);
      };
    });
  }

  /**
   * Snooze a reminder
   */
  async snoozeReminder(reminderId: string, days: number): Promise<void> {
    const database = await getDb();
    const snoozedUntil = Date.now() + days * 24 * 60 * 60 * 1000;

    return new Promise((resolve, reject) => {
      const tx = database.transaction('reminders', 'readwrite');
      const store = tx.objectStore('reminders');
      const request = store.get(reminderId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const reminder = request.result as Reminder;
        if (reminder) {
          reminder.snoozedUntil = snoozedUntil;
          store.put(reminder);
          this.trackAnalytics('snooze', reminderId);
        }
        resolve();
      };
    });
  }

  /**
   * Dismiss a reminder
   */
  async dismissReminder(reminderId: string): Promise<void> {
    const database = await getDb();

    return new Promise((resolve, reject) => {
      const tx = database.transaction('reminders', 'readwrite');
      const store = tx.objectStore('reminders');
      const request = store.get(reminderId);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const reminder = request.result as Reminder;
        if (reminder) {
          reminder.dismissed = true;
          store.put(reminder);
          this.trackAnalytics('dismiss', reminderId);
        }
        resolve();
      };
    });
  }

  /**
   * Show push notification for a reminder
   */
  async showNotification(reminder: Reminder): Promise<void> {
    const settings = this.getSettings();
    if (!settings.pushEnabled || this.isQuietHours()) return;

    const hasPermission = await this.requestPermission();
    if (!hasPermission) return;

    const notification = new Notification('Idea Needs Attention', {
      body: `${reminder.ideaTitle}: ${reminder.reason}`,
      icon: '/favicon.ico',
      tag: `reminder-${reminder.id}`,
      requireInteraction: true,
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
      this.trackAnalytics('click', reminder.id);
    };
  }

  /**
   * Track analytics for reminder interactions
   */
  private async trackAnalytics(
    action: 'show' | 'click' | 'snooze' | 'dismiss',
    reminderId: string
  ): Promise<void> {
    const database = await getDb();
    const event = {
      id: crypto.randomUUID(),
      action,
      reminderId,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      const tx = database.transaction('analytics', 'readwrite');
      const store = tx.objectStore('analytics');
      const request = store.add(event);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Get analytics summary
   */
  async getAnalyticsSummary(): Promise<{
    totalReminders: number;
    clicked: number;
    snoozed: number;
    dismissed: number;
  }> {
    const database = await getDb();

    return new Promise((resolve, reject) => {
      const tx = database.transaction('analytics', 'readonly');
      const store = tx.objectStore('analytics');
      const request = store.getAll();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const events = request.result as { action: string }[];
        resolve({
          totalReminders: events.filter((e) => e.action === 'show').length,
          clicked: events.filter((e) => e.action === 'click').length,
          snoozed: events.filter((e) => e.action === 'snooze').length,
          dismissed: events.filter((e) => e.action === 'dismiss').length,
        });
      };
    });
  }
}

export const remindersService = new RemindersService();
