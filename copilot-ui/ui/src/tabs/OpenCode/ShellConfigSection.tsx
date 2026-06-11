import { useState } from 'react';
import { Button, FormInput, Panel, ToggleField } from '../../components';
import { opencodeStore } from '../../stores/opencodeStore';
import type { OpenCodeShellConfig, OpenCodeStatusResponse } from '../../lib/types';

interface ShellConfigSectionProps {
  status: OpenCodeStatusResponse;
}

const DEFAULT_SHELL_INFO: Record<string, { label: string; description: string }> = {
  pwsh: { label: 'PowerShell 7+', description: 'Modern cross-platform PowerShell' },
  powershell: { label: 'Windows PowerShell', description: 'Legacy Windows PowerShell 5.1' },
  bash: { label: 'Bash', description: 'GNU Bourne-Again SHell' },
  zsh: { label: 'Zsh', description: 'Z Shell with extended features' },
  cmd: { label: 'Command Prompt', description: 'Windows cmd.exe' },
  fish: { label: 'Fish', description: 'Friendly interactive shell (not recommended)' },
  'git-bash': { label: 'Git Bash', description: 'MINGW64 bash from Git for Windows' },
};

export default function ShellConfigSection({ status }: ShellConfigSectionProps) {
  const config = status.configPreview || {};

  const currentShell = config.shell as OpenCodeShellConfig | undefined;
  const autoDetect = !currentShell || (!currentShell.path && !currentShell.args);

  const [shellPath, setShellPath] = useState(currentShell?.path || '');
  const [shellArgs, setShellArgs] = useState(
    currentShell?.args ? currentShell.args.join(' ') : '-l'
  );
  const [isAutoDetect, setIsAutoDetect] = useState(autoDetect);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const shellValue = isAutoDetect
        ? null
        : {
            path: shellPath.trim() || undefined,
            args: shellArgs.trim()
              ? shellArgs.trim().split(/\s+/)
              : undefined,
          };
      await opencodeStore.saveShellConfig(shellValue);
      setMessage(isAutoDetect ? 'Shell set to auto-detect.' : 'Shell configuration saved.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Failed to save shell config.');
    } finally {
      setSaving(false);
    }
  };

  const detectedShell = detectShell();

  return (
    <div className="opencode-section" data-testid="opencode-shell">
      <Panel
        title="Shell Configuration"
        subtitle="Configure the shell used by OpenCode for agent tool calls and the interactive terminal"
        testId="opencode-shell-panel"
      >
        <div className="shell-config-info">
          <p className="shell-config-description">
            OpenCode uses a shell to execute commands. On Windows, it auto-detects
            PowerShell 7+, Windows PowerShell, Git Bash, or cmd.exe. On macOS/Linux,
            it defaults to zsh or bash. You can override this with a custom shell path.
          </p>
        </div>

        <ToggleField
          label="Auto-detect Shell"
          description="Automatically detect and use the best shell for your platform. Disable to set a custom shell."
          checked={isAutoDetect}
          onChange={() => setIsAutoDetect(!isAutoDetect)}
          testId="opencode-shell-autodetect"
        />

        {!isAutoDetect && (
          <div className="shell-config-fields">
            <FormInput
              label="Shell Path"
              value={shellPath}
              onValueChange={setShellPath}
              placeholder={detectedShell.placeholder}
              disabled={saving}
              testId="opencode-shell-path"
            />
            <FormInput
              label="Shell Arguments"
              value={shellArgs}
              onValueChange={setShellArgs}
              placeholder="-l"
              disabled={saving}
              testId="opencode-shell-args"
            />
            <p className="shell-config-hint">
              Common args: <code>-l</code> (login shell), <code>-i</code> (interactive),
              <code>-c</code> (command). Default: <code>-l</code>
            </p>
          </div>
        )}

        <div className="shell-config-detected">
          <h4 className="shell-config-detected-title">Platform Default</h4>
          <div className="shell-config-detected-info">
            <span className="shell-config-detected-name">{detectedShell.name}</span>
            <span className="shell-config-detected-path">{detectedShell.path}</span>
          </div>
          <p className="shell-config-detected-desc">{detectedShell.description}</p>
        </div>

        <div className="shell-config-platforms">
          <h4 className="shell-config-platforms-title">Platform Defaults</h4>
          <div className="shell-config-platforms-grid">
            {Object.entries(DEFAULT_SHELL_INFO).map(([key, info]) => (
              <div key={key} className="shell-config-platform-item">
                <span className="shell-config-platform-name">{info.label}</span>
                <span className="shell-config-platform-key">{key}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="shell-config-actions">
          <Button
            variant="primary"
            size="sm"
            testId="opencode-shell-save"
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? 'Saving...' : 'Save Shell Config'}
          </Button>
          {message && (
            <span className={`shell-config-message ${message.includes('Failed') ? 'shell-config-message-error' : ''}`}>
              {message}
            </span>
          )}
        </div>
      </Panel>
    </div>
  );
}

function detectShell(): { name: string; path: string; placeholder: string; description: string } {
  const platform = navigator.platform.toLowerCase();
  const isWindows = platform.includes('win');

  if (isWindows) {
    return {
      name: 'PowerShell 7+',
      path: 'pwsh.exe',
      placeholder: 'pwsh, powershell, /bin/bash, /usr/bin/zsh',
      description: 'Auto-detected: PowerShell 7+ (pwsh.exe) on Windows',
    };
  }

  return {
    name: 'Zsh',
    path: '/bin/zsh',
    placeholder: '/bin/zsh, /bin/bash, /usr/bin/fish',
    description: 'Auto-detected: Zsh on macOS/Linux',
  };
}
