import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";

const IS_WIN = process.platform === "win32";

function loadConfig(projectPath) {
  const defaults = {
    enabled: true,
    events: {
      sessionIdle: true,
      sessionError: true,
      permissionAsked: true,
    },
    title: "OpenCode",
  };

  if (!projectPath) return defaults;

  try {
    const configPath = join(projectPath, ".opencode", "notify.json");
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf8");
      const user = JSON.parse(raw);
      return {
        ...defaults,
        ...user,
        events: { ...defaults.events, ...(user.events || {}) },
      };
    }
  } catch {
    // ignore malformed config, use defaults
  }

  return defaults;
}

function notifyWindows(title, message) {
  try {
    const psScript = [
      "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
      "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null",
      `$template = "<toast><visual><binding template='ToastGeneric'><text>${title}</text><text>${message}</text></binding></visual></toast>"`,
      "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument",
      "$xml.LoadXml($template)",
      "$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)",
      "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('OpenCode').Show($toast)",
    ].join("; ");

    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psScript], {
      timeout: 5000,
      windowsHide: true,
    }, () => {});
  } catch {
    // notification failure is non-fatal
  }
}

function notifyMacOS(title, message) {
  try {
    execFile("osascript", [
      "-e",
      `display notification "${message}" with title "${title}"`,
    ], { timeout: 5000 }, () => {});
  } catch {
    // non-fatal
  }
}

function notifyLinux(title, message) {
  try {
    execFile("notify-send", [title, message], { timeout: 5000 }, () => {});
  } catch {
    // non-fatal
  }
}

function sendNotification(title, message) {
  if (IS_WIN) {
    notifyWindows(title, message);
  } else if (process.platform === "darwin") {
    notifyMacOS(title, message);
  } else {
    notifyLinux(title, message);
  }
}

export const NotifyPlugin = async ({ project, directory }) => {
  const projectPath = (project && project.path) || directory;
  const config = loadConfig(projectPath);

  if (!config.enabled) {
    return {};
  }

  return {
    event: async ({ event }) => {
      if (!event || !event.type) return;

      if (event.type === "session.idle" && config.events.sessionIdle) {
        sendNotification(config.title, "Session completed — waiting for input");
      } else if (event.type === "session.error" && config.events.sessionError) {
        const message = (event.properties && (event.properties.error || event.properties.message))
          || "An error occurred";
        sendNotification(config.title, String(message).slice(0, 200));
      } else if (event.type === "permission.asked" && config.events.permissionAsked) {
        sendNotification(config.title, "Permission needed — check OpenCode");
      }
    },
  };
};

export default NotifyPlugin;
