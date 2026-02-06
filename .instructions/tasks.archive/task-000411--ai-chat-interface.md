---
schema: task/v1
id: task-000411
title: "Create AI chat interface"
type: feature
status: done
priority: high
owner: lolzi
skills: ["frontend", "react-query", "openai-compatible"]
depends_on: ["task-000405"]
next_tasks: ["task-000417"]
created: "2026-02-01"
updated: "2026-02-01"
---

## Context

AI Chat interface for brainstorming and learning using GitHub Models API (via user's GitHub Pro account). Enables:
- Asynchronous idea refinement and exploration
- Code questions and learning (distinct from agentic work sessions)
- Markdown rendering with code syntax highlighting
- Chat history persistence across sessions
- Multiple conversation threads

This provides a lightweight AI interaction mode separate from agent session management.

**Technical Context**:
- Uses GitHub Models API (user provides API key from GitHub Pro)
- Integrates with `task-000405` app shell (AI Chat tab/screen)
- Streaming responses preferred for real-time feel
- Markdown rendering with code blocks (syntax highlighting)
- Store chat history in IndexedDB or user profile backend

**Related Files**:
- `mobile-companion/src/components/AIChat/` (to be created)
- `.github/skills/openai-compatible/SKILL.md` (reference for API patterns)
- Plan artefact: `.instructions/artefacts/mobile-companion-PLAN-artefact.md`

## Acceptance Criteria

- [x] Chat interface with message input (keyboard + send button)
- [x] GitHub Models API integration using user's API key
- [x] Streaming responses with real-time message display
- [x] Markdown rendering for assistant responses
- [x] Code syntax highlighting (detect language from fence markers)
- [x] Multiple conversation threads with thread selector
- [x] Chat history persistence (IndexedDB or backend)
- [x] Loading/typing indicator for streaming responses
- [x] Error handling (API rate limits, network failures, invalid key)
- [x] Responsive design for mobile screens

## Plan / Approach

Implemented using a layered architecture:
1. **Storage Layer**: `chatDb.ts` - IndexedDB with conversations and messages
2. **API Layer**: `githubModelsApi.ts` - GitHub Models API client with streaming
3. **Render Layer**: `MarkdownContent.tsx` - Markdown parser with code highlighting
4. **Page Layer**: `AiChat.tsx` - Full chat interface with thread management

## Attempts / Log

**Session 1** (Task completed):
- Created `mobile-companion/src/services/chatDb.ts` - IndexedDB storage for conversations
- Created `mobile-companion/src/services/githubModelsApi.ts` - GitHub Models API with streaming
- Created `mobile-companion/src/components/chat/MarkdownContent.tsx` - Markdown renderer
- Created `mobile-companion/src/components/chat/MarkdownContent.css` - Code highlighting styles
- Updated `mobile-companion/src/pages/AiChat.tsx` - Full chat UI with sidebar
- Updated `mobile-companion/src/pages/AiChat.css` - Responsive styles
- Build verified: 134 modules, 296KB JS

## Failures

(None - implementation succeeded)

## Notes / Discoveries

- GitHub Models API is OpenAI-compatible at `https://models.inference.ai.azure.com/chat/completions`
- API key stored in localStorage (simple approach; user configures on first use)
- Markdown renderer handles: code blocks, headers, lists, bold, italic, inline code, links
- Conversation auto-titles from first user message
- Sidebar overlay pattern works well for mobile thread switching
- Streaming via ReadableStream with SSE parsing for real-time display

## Next Steps

1. ~~Create chat UI component with input and message list~~ ✓
2. ~~Integrate GitHub Models API (fetch + streaming)~~ ✓
3. ~~Implement markdown renderer with code highlighting~~ ✓
4. ~~Add thread management (create/switch/delete threads)~~ ✓
5. ~~Build chat history persistence (IndexedDB or backend)~~ ✓
6. ~~Test streaming latency and markdown rendering performance~~ ✓

Task complete. Unblocks task-000417 (learning mode with checkpoints).
