/**
 * Web Push Notification Service
 *
 * Manages VAPID-based push subscriptions and sends push notifications
 * to mobile PWA clients when they're not connected via WebSocket.
 *
 * Requires VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and optionally
 * VAPID_SUBJECT environment variables.
 */

import webPush from "web-push";
import crypto from "crypto";
import { RelayDatabase } from "./database";

export interface PushSubscriptionData {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  keys_p256dh: string;
  keys_auth: string;
  created_at: string;
}

export class PushService {
  private db: RelayDatabase;
  private configured: boolean = false;

  constructor(db: RelayDatabase) {
    this.db = db;

    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const subject = process.env.VAPID_SUBJECT || "mailto:admin@sfrsh.xyz";

    if (publicKey && privateKey) {
      webPush.setVapidDetails(subject, publicKey, privateKey);
      this.configured = true;
    }
  }

  /** Whether VAPID keys are configured and push is available. */
  isConfigured(): boolean {
    return this.configured;
  }

  /** Return the VAPID public key, or null if not configured. */
  getPublicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY || null;
  }

  /**
   * Store a push subscription for the given user.
   * Uses INSERT OR REPLACE to handle re-subscribing with the same endpoint.
   */
  subscribe(userId: string, subscription: PushSubscriptionData): void {
    const id = crypto.randomUUID();
    this.db
      .getDb()
      .prepare(
        "INSERT OR REPLACE INTO push_subscriptions (id, user_id, endpoint, keys_p256dh, keys_auth) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth);
  }

  /**
   * Remove a push subscription by user + endpoint.
   * Returns true if a row was deleted, false otherwise.
   */
  unsubscribe(userId: string, endpoint: string): boolean {
    const result = this.db
      .getDb()
      .prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?")
      .run(userId, endpoint);
    return result.changes > 0;
  }

  /**
   * Send a push notification to all subscriptions for a given user.
   * Automatically removes expired/invalid subscriptions (410 Gone, 404).
   */
  async sendToUser(
    userId: string,
    payload: object,
  ): Promise<{ sent: number; failed: number }> {
    if (!this.configured) {
      throw new Error("VAPID not configured");
    }

    const subs = this.db
      .getDb()
      .prepare("SELECT * FROM push_subscriptions WHERE user_id = ?")
      .all(userId) as PushSubscriptionRow[];

    let sent = 0;
    let failed = 0;

    for (const sub of subs) {
      try {
        await webPush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
          },
          JSON.stringify(payload),
        );
        sent++;
      } catch (error: any) {
        failed++;
        // Remove expired/invalid subscriptions
        if (error.statusCode === 410 || error.statusCode === 404) {
          this.db
            .getDb()
            .prepare("DELETE FROM push_subscriptions WHERE id = ?")
            .run(sub.id);
        }
      }
    }

    return { sent, failed };
  }

  /** Return the number of active push subscriptions for a user. */
  getSubscriptionCount(userId: string): number {
    const row = this.db
      .getDb()
      .prepare("SELECT COUNT(*) as count FROM push_subscriptions WHERE user_id = ?")
      .get(userId) as { count: number };
    return row.count;
  }
}
