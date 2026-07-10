import Panel from '../../components/Panel';
import { useStoreValue } from '../../lib/store';
import { shellPreferencesStore, type ThemePreference } from '../../stores/shellPreferences';

export default function AppearanceSettings() {
  const preferences = useStoreValue(shellPreferencesStore);

  return (
    <Panel title="Appearance" subtitle="Theme and workspace shell" testId="settings-appearance">
      <label className="appearance-setting" htmlFor="theme-preference">
        <span className="appearance-setting-copy">
          <strong>Theme</strong>
          <span>Follow your operating system or choose a persistent override.</span>
        </span>
        <select
          id="theme-preference"
          data-testid="theme-preference"
          value={preferences.themePreference}
          onChange={(event) => shellPreferencesStore.setThemePreference(event.target.value as ThemePreference)}
        >
          <option value="system">Use system setting</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
    </Panel>
  );
}
