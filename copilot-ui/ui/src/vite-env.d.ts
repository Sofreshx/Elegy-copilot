/// <reference types="vite/client" />

import type { DesktopUpdaterState } from './lib/types';

declare global {
	interface Window {
		instructionEngineDesktop?: {
			platform: string;
			shell: string;
			updater?: {
				getState: () => Promise<DesktopUpdaterState>;
				checkForUpdates: () => Promise<DesktopUpdaterState>;
				downloadUpdate: () => Promise<DesktopUpdaterState>;
				restartToUpdate: () => Promise<boolean>;
				subscribe: (listener: (state: DesktopUpdaterState) => void) => () => void;
			};
		};
		__TAURI__?: {
			core: {
				invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
			};
			webviewWindow: {
				WebviewWindow: {
					new (
						label: string,
						options: {
							url: string;
							title?: string;
							width?: number;
							height?: number;
							minWidth?: number;
							minHeight?: number;
							resizable?: boolean;
							visible?: boolean;
							center?: boolean;
							decorations?: boolean;
						},
					): {
						label: string;
						close: () => Promise<void>;
					};
					create: (
						label: string,
						options: {
							url: string;
							title?: string;
							width?: number;
							height?: number;
							minWidth?: number;
							minHeight?: number;
							resizable?: boolean;
							visible?: boolean;
							center?: boolean;
							decorations?: boolean;
						},
					) => Promise<{
						label: string;
						close: () => Promise<void>;
					}>;
				};
			};
		};
	}
}

export {};
