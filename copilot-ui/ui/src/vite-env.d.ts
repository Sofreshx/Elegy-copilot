/// <reference types="vite/client" />

import type { DesktopUpdaterState } from './lib/types';

declare global {
	interface Window {
		instructionEngineDesktop?: {
			platform: string;
			electronVersion: string;
			updater?: {
				getState: () => Promise<DesktopUpdaterState>;
				checkForUpdates: () => Promise<DesktopUpdaterState>;
				downloadUpdate: () => Promise<DesktopUpdaterState>;
				restartToUpdate: () => Promise<boolean>;
				subscribe: (listener: (state: DesktopUpdaterState) => void) => () => void;
			};
		};
	}
}

export {};
