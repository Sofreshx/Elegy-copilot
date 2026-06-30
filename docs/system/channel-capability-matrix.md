---
created: 2026-02-26
updated: 2026-06-30
category: system
status: current
doc_kind: node
id: channel-capability-matrix
summary: Feature × platform capability matrix for Discord and Telegram channels, with fallback behaviour per unsupported cell.
tags: [discord, telegram, channels, capabilities, matrix]
---

# Channel Capability Matrix

Quick-reference card mapping each agent-facing feature to its platform support status across Discord and Telegram.

## Matrix

| Feature | Discord | Telegram | Fallback (when ❌) |
|---|---|---|---|
| Slash commands | ✅ Native | ✅ BotCommand menu | — |
| Threads (per-session) | ✅ Forum / text threads | ❌ | Inline message editing |
| Permission prompts (interactive) | ✅ Button-based approve / deny | ❌ | Auto-approve or timeout |
| Session summary (persistent) | ✅ Pinned / updated message | ❌ | Omitted |
| Ephemeral replies | ✅ Native ephemeral | ❌ | Regular message (visible to all) |
| Inline message editing | ✅ | ✅ | — |
| Rate limiting | ✅ Per-tier | ✅ Per-tier | — |
| Guild / channel scope enforcement | ✅ Required | ❌ N/A | Skipped (per WU-005) |
| Per-platform allowlists | ✅ | ✅ | Falls to global allowlist |

## Fallback Notes

- **Threads** — Telegram has no thread primitive. The adapter falls back to editing the most recent bot message in place, keeping context inline rather than splitting into a sub-conversation.
- **Permission prompts** — Without interactive buttons, Telegram sessions either auto-approve low-risk actions or apply a configurable timeout before proceeding.
- **Session summary** — Discord pins a living summary message; Telegram has no pinned-message-update equivalent exposed to the bot, so summaries are omitted.
- **Ephemeral replies** — Discord can send messages visible only to the invoking user. Telegram lacks this; replies are sent as regular messages visible to all chat members.
- **Guild / channel scope** — Discord requires guild + channel IDs for scoping. Telegram chats don't map to this model, so scope enforcement is skipped per the allowlist design (WU-005).

## Implementation References

| Capability interface | Source file |
|---|---|
| `PlatformPermissionPromptCapability` | `platformCapabilities.ts` |
| `PlatformSessionSummaryCapability` | `platformCapabilities.ts` |
| `PlatformCommandInteraction.createThread` | `platform.ts` (optional) |
