import { useState, useCallback } from 'react';

interface CopyButtonProps {
  text: string;
  testId?: string;
}

export default function CopyButton({ text, testId = 'copy-button' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in non-secure contexts — silently ignore
    }
  }, [text]);

  return (
    <button
      className={`copy-button${copied ? ' copy-button-copied' : ''}`}
      data-testid={testId}
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied' : 'Copy to clipboard'}
    >
      {copied ? '✓' : '📋'}
    </button>
  );
}
