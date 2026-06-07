/// <reference types="vite/client" />

import type { DesktopUpdaterState } from './lib/types';

export type TauriResizeDirection =
	| 'East'
	| 'West'
	| 'North'
	| 'South'
	| 'NorthEast'
	| 'NorthWest'
	| 'SouthEast'
	| 'SouthWest';

export interface DesktopWindowControls {
	minimize: () => Promise<void>;
	toggleMaximize: () => Promise<void>;
	close: () => Promise<void>;
	isMaximized: () => Promise<boolean>;
	startResizeDragging: (direction: TauriResizeDirection) => Promise<void>;
}

declare global {
	interface Window {
		instructionEngineDesktop?: {
			platform: string;
			shell: string;
			windowControls?: DesktopWindowControls;
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
			window?: {
				getCurrentWindow: () => {
					minimize: () => Promise<void>;
					unminimize: () => Promise<void>;
					toggleMaximize: () => Promise<void>;
					maximize: () => Promise<void>;
					unmaximize: () => Promise<void>;
					close: () => Promise<void>;
					isMaximized: () => Promise<boolean>;
					startResizeDragging: (direction: TauriResizeDirection) => Promise<void>;
					startDragging: () => Promise<void>;
				};
			};
			webviewWindow: {
				WebviewWindow: new (
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
				) => {
					label: string;
					close: () => Promise<void>;
					once: (event: string, handler: (...args: unknown[]) => void) => void;
					listen: (event: string, handler: (...args: unknown[]) => void) => Promise<() => void>;
				};
			};
		};
	}
}

export {};
