import { useState, useRef, useEffect } from 'react';
import { chatDb, ChatMessage, Conversation } from '../services/chatDb';
import { githubModelsApi } from '../services/githubModelsApi';
import MarkdownContent from '../components/chat/MarkdownContent';
import './AiChat.css';

export default function AiChat() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [showApiKeyInput, setShowApiKeyInput] = useState(!githubModelsApi.hasApiKey());
  const [apiKeyInput, setApiKeyInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentConversation?.messages, streamingContent]);

  const loadConversations = async () => {
    const convos = await chatDb.getAllConversations();
    setConversations(convos);
    if (convos.length > 0 && !currentConversation) {
      setCurrentConversation(convos[0] ?? null);
    }
  };

  const createNewConversation = async () => {
    const convo = await chatDb.createConversation();
    setConversations((prev) => [convo, ...prev]);
    setCurrentConversation(convo);
    setShowSidebar(false);
  };

  const selectConversation = (convo: Conversation) => {
    setCurrentConversation(convo);
    setShowSidebar(false);
  };

  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await chatDb.deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (currentConversation?.id === id) {
      const remaining = conversations.filter((c) => c.id !== id);
      setCurrentConversation(remaining[0] || null);
    }
  };

  const saveApiKey = () => {
    if (apiKeyInput.trim()) {
      githubModelsApi.setApiKey(apiKeyInput.trim());
      setShowApiKeyInput(false);
      setApiKeyInput('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    setError(null);

    // Create conversation if needed
    let convo = currentConversation;
    if (!convo) {
      convo = await chatDb.createConversation();
      setConversations((prev) => [convo!, ...prev]);
      setCurrentConversation(convo);
    }

    // Add user message
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    convo = { ...convo, messages: [...convo.messages, userMessage] };
    setCurrentConversation(convo);
    await chatDb.addMessage(convo.id, userMessage);
    setInput('');

    // Start streaming response
    setIsStreaming(true);
    setStreamingContent('');

    try {
      const stream = githubModelsApi.chatStream(convo.messages);
      let fullContent = '';

      for await (const chunk of stream) {
        fullContent += chunk;
        setStreamingContent(fullContent);
      }

      // Save assistant message
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: fullContent,
        timestamp: Date.now(),
      };

      const updatedConvo = {
        ...convo,
        messages: [...convo.messages, assistantMessage],
      };
      setCurrentConversation(updatedConvo);
      await chatDb.addMessage(convo.id, assistantMessage);
      
      // Reload to get updated title
      loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get response');
    } finally {
      setIsStreaming(false);
      setStreamingContent('');
    }
  };

  const handleSuggestion = (text: string) => {
    setInput(text);
  };

  if (showApiKeyInput) {
    return (
      <div className="page ai-chat">
        <div className="api-key-setup">
          <div className="api-key-icon">🔑</div>
          <h2>Configure GitHub Models API</h2>
          <p>Enter your GitHub Models API key to enable AI chat.</p>
          <p className="api-key-hint">
            Get your API key from{' '}
            <a href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer">
              GitHub Settings → Tokens
            </a>
          </p>
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder="ghp_xxxxxxxxxxxxx"
            className="api-key-input"
          />
          <button onClick={saveApiKey} className="api-key-button" disabled={!apiKeyInput.trim()}>
            Save API Key
          </button>
        </div>
      </div>
    );
  }

  const messages = currentConversation?.messages || [];

  return (
    <div className="page ai-chat">
      <header className="chat-header">
        <button className="menu-button" onClick={() => setShowSidebar(true)}>
          <MenuIcon />
        </button>
        <div className="header-title">
          <h1 className="page-title">{currentConversation?.title || 'AI Chat'}</h1>
        </div>
        <button className="new-chat-button" onClick={createNewConversation}>
          <PlusIcon />
        </button>
      </header>

      {/* Sidebar */}
      {showSidebar && (
        <div className="chat-sidebar-overlay" onClick={() => setShowSidebar(false)}>
          <div className="chat-sidebar" onClick={(e) => e.stopPropagation()}>
            <div className="sidebar-header">
              <h2>Conversations</h2>
              <button onClick={() => setShowSidebar(false)}>×</button>
            </div>
            <button className="new-chat-sidebar" onClick={createNewConversation}>
              <PlusIcon /> New Chat
            </button>
            <div className="conversation-list">
              {conversations.map((convo) => (
                <div
                  key={convo.id}
                  className={`conversation-item ${convo.id === currentConversation?.id ? 'active' : ''}`}
                  onClick={() => selectConversation(convo)}
                >
                  <span className="conversation-title">{convo.title}</span>
                  <button
                    className="delete-conversation"
                    onClick={(e) => deleteConversation(convo.id, e)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              className="settings-api-key"
              onClick={() => setShowApiKeyInput(true)}
            >
              🔑 Change API Key
            </button>
          </div>
        </div>
      )}

      <div className="chat-messages">
        {messages.length === 0 && !isStreaming ? (
          <div className="chat-empty">
            <div className="chat-empty-icon">🤖</div>
            <p>Start a conversation with AI</p>
            <div className="suggestions">
              <button className="suggestion" onClick={() => handleSuggestion('Help me plan a new feature')}>
                Help me plan a new feature
              </button>
              <button className="suggestion" onClick={() => handleSuggestion('Explain this error')}>
                Explain this error
              </button>
              <button className="suggestion" onClick={() => handleSuggestion('Review my approach')}>
                Review my approach
              </button>
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <div key={message.id} className={`message ${message.role}`}>
                <div className="message-content">
                  {message.role === 'assistant' ? (
                    <MarkdownContent content={message.content} />
                  ) : (
                    message.content
                  )}
                </div>
              </div>
            ))}
            {isStreaming && (
              <div className="message assistant">
                <div className="message-content">
                  {streamingContent ? (
                    <MarkdownContent content={streamingContent} />
                  ) : (
                    <div className="typing-indicator">
                      <span className="dot" />
                      <span className="dot" />
                      <span className="dot" />
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
        {error && (
          <div className="chat-error">
            <span className="error-icon">⚠️</span>
            {error}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
          className="chat-input"
          disabled={isStreaming}
        />
        <button type="submit" className="send-button" disabled={!input.trim() || isStreaming}>
          <SendIcon />
        </button>
      </form>
    </div>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12h18M3 6h18M3 18h18" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
