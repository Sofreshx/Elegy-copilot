/**
 * Push Notification REST API Routes
 *
 * Endpoints for managing Web Push subscriptions and sending push notifications.
 *
 * Public:
 *   GET  /push/vapid-public-key  — returns the VAPID public key
 *
 * Authenticated:
 *   POST   /push/subscribe    — register a push subscription
 *   DELETE /push/unsubscribe  — remove a push subscription
 *   POST   /push/send         — send a push notification to a user
 */

import { Router, Request, Response, NextFunction } from "express";
import { PushService } from "./pushService";
import { TokenService } from "./tokenService";

export function createPushRouter(pushService: PushService, tokenService: TokenService): Router {
  const router = Router();

  // ---------------------------------------------------------------------------
  // Auth middleware (reused pattern from sessionRoutes / taskRoutes)
  // ---------------------------------------------------------------------------

  const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Bearer token required" });
      return;
    }
    const token = authHeader.slice(7);
    const claims = tokenService.verifyAccessToken(token);
    if (!claims) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    (req as any).claims = claims;
    next();
  };

  // ---------------------------------------------------------------------------
  // GET /push/vapid-public-key — public, no auth required
  // ---------------------------------------------------------------------------

  router.get("/push/vapid-public-key", (_req: Request, res: Response): void => {
    const publicKey = pushService.getPublicKey();
    if (!publicKey) {
      res.status(503).json({ error: "Push notifications not configured" });
      return;
    }
    res.json({ publicKey });
  });

  // ---------------------------------------------------------------------------
  // POST /push/subscribe — register a push subscription for the authed user
  // ---------------------------------------------------------------------------

  router.post("/push/subscribe", requireAuth, (req: Request, res: Response): void => {
    const claims = (req as any).claims;
    const { subscription } = req.body;

    if (
      !subscription ||
      !subscription.endpoint ||
      !subscription.keys?.p256dh ||
      !subscription.keys?.auth
    ) {
      res.status(400).json({
        error:
          "Invalid subscription. Required: subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth",
      });
      return;
    }

    pushService.subscribe(claims.sub, {
      endpoint: subscription.endpoint,
      keys: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    });

    const count = pushService.getSubscriptionCount(claims.sub);
    res.status(201).json({ success: true, activeSubscriptions: count });
  });

  // ---------------------------------------------------------------------------
  // DELETE /push/unsubscribe — remove a push subscription
  // ---------------------------------------------------------------------------

  router.delete("/push/unsubscribe", requireAuth, (req: Request, res: Response): void => {
    const claims = (req as any).claims;
    const { endpoint } = req.body;

    if (!endpoint) {
      res.status(400).json({ error: "endpoint is required" });
      return;
    }

    const deleted = pushService.unsubscribe(claims.sub, endpoint);
    if (!deleted) {
      res.status(404).json({ error: "Subscription not found" });
      return;
    }

    res.json({ success: true, deleted: true });
  });

  // ---------------------------------------------------------------------------
  // POST /push/send — send a push notification to a specified user
  // ---------------------------------------------------------------------------

  router.post("/push/send", requireAuth, async (req: Request, res: Response): Promise<void> => {
    const claims = (req as any).claims;
    const { userId, payload } = req.body;

    if (!userId) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    // Authorization: users can only send push to themselves
    if (userId !== claims.sub) {
      res.status(403).json({ error: "Cannot send push notifications to other users" });
      return;
    }
    if (!payload) {
      res.status(400).json({ error: "payload is required" });
      return;
    }

    if (!pushService.isConfigured()) {
      res.status(503).json({ error: "Push notifications not configured (VAPID keys missing)" });
      return;
    }

    try {
      const result = await pushService.sendToUser(userId, payload);
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to send push notification" });
    }
  });

  return router;
}
