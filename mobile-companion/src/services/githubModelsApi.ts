/**
 * GitHub Models API client (OpenAI-compatible).
 * Uses user's GitHub Pro API key for access.
 */

import { ChatMessage } from './chatDb';

// GitHub Models API endpoint (OpenAI-compatible)
const GITHUB_MODELS_URL = 'https://models.inference.ai.azure.com/chat/completions';

// Default model - can be changed in settings
const DEFAULT_MODEL = 'gpt-4o-mini';

export interface ChatCompletionOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatCompletionResponse {
  id: string;
  choices: {
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: string;
  }[];
}

export interface StreamChunk {
  choices: {
    delta: {
      content?: string;
    };
    finish_reason: string | null;
  }[];
}

// API key storage key
const API_KEY_STORAGE_KEY = 'github-models-api-key';

export const githubModelsApi = {
  /**
   * Get stored API key
   */
  getApiKey(): string | null {
    return localStorage.getItem(API_KEY_STORAGE_KEY);
  },

  /**
   * Store API key
   */
  setApiKey(apiKey: string): void {
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
  },

  /**
   * Remove stored API key
   */
  clearApiKey(): void {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  },

  /**
   * Check if API key is configured
   */
  hasApiKey(): boolean {
    return !!this.getApiKey();
  },

  /**
   * Send a chat completion request (non-streaming)
   */
  async chat(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): Promise<string> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('GitHub Models API key not configured');
    }

    const response = await fetch(GITHUB_MODELS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model || DEFAULT_MODEL,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2048,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      if (response.status === 401) {
        throw new Error('Invalid API key. Please check your GitHub Models API key.');
      }
      if (response.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      throw new Error(`API error: ${response.status} - ${error}`);
    }

    const data: ChatCompletionResponse = await response.json();
    return data.choices[0]?.message?.content || '';
  },

  /**
   * Send a streaming chat completion request
   */
  async *chatStream(
    messages: ChatMessage[],
    options: ChatCompletionOptions = {}
  ): AsyncGenerator<string, void, unknown> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('GitHub Models API key not configured');
    }

    const response = await fetch(GITHUB_MODELS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: options.model || DEFAULT_MODEL,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens ?? 2048,
        stream: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      if (response.status === 401) {
        throw new Error('Invalid API key. Please check your GitHub Models API key.');
      }
      if (response.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      throw new Error(`API error: ${response.status} - ${error}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              return;
            }
            try {
              const chunk: StreamChunk = JSON.parse(data);
              const content = chunk.choices[0]?.delta?.content;
              if (content) {
                yield content;
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  },

  /**
   * Test API connection with a simple request
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.chat([{
        id: 'test',
        role: 'user',
        content: 'Hi',
        timestamp: Date.now(),
      }], { maxTokens: 10 });
      return true;
    } catch {
      return false;
    }
  },
};
