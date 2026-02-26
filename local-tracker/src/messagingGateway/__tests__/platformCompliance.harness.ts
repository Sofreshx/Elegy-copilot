import type { MessagePlatform, PlatformCommandSpec, PlatformCommandHandler } from '../platform';

export interface PlatformComplianceOptions {
	/** Human-readable name for the platform, used in describe block titles */
	platformName: string;
	/** Expected PlatformKind value */
	expectedKind: string;
	/** Factory that creates a fresh instance for each test */
	factory: () => MessagePlatform;
}

/**
 * Runs the standard platform compliance suite against any MessagePlatform implementation.
 * Call this inside a describe block in your platform-specific test file.
 */
export function runPlatformComplianceSuite(options: PlatformComplianceOptions): void {
	const { platformName, expectedKind, factory } = options;

	describe(`${platformName} — Platform Compliance`, () => {
		let platform: MessagePlatform;

		beforeEach(() => {
			platform = factory();
		});

		afterEach(async () => {
			try { await platform.stop(); } catch { /* ignore */ }
		});

		// 1. Kind
		it('has the correct kind', () => {
			expect(platform.kind).toBe(expectedKind);
		});

		// 2. Start
		it('start() resolves without error', async () => {
			await expect(platform.start()).resolves.not.toThrow();
		});

		// 3. Start idempotency
		it('start() is idempotent (calling twice does not throw)', async () => {
			await platform.start();
			await expect(platform.start()).resolves.not.toThrow();
		});

		// 4. Stop
		it('stop() resolves without error', async () => {
			await platform.start();
			await expect(platform.stop()).resolves.not.toThrow();
		});

		// 5. Stop idempotency
		it('stop() is idempotent (calling twice does not throw)', async () => {
			await platform.start();
			await platform.stop();
			await expect(platform.stop()).resolves.not.toThrow();
		});

		// 6. Stop before start
		it('stop() before start() does not throw', async () => {
			await expect(platform.stop()).resolves.not.toThrow();
		});

		// 7. registerCommands
		it('registerCommands() accepts a command spec array', async () => {
			await platform.start();
			const specs: PlatformCommandSpec[] = [
				{ name: '/test', description: 'Test command', tier: 'read' },
			];
			await expect(platform.registerCommands(specs)).resolves.not.toThrow();
		});

		// 8. registerCommands with empty array
		it('registerCommands() accepts an empty array', async () => {
			await platform.start();
			await expect(platform.registerCommands([])).resolves.not.toThrow();
		});

		// 9. setCommandHandler
		it('setCommandHandler() accepts a handler function', () => {
			const handler: PlatformCommandHandler = jest.fn();
			expect(() => platform.setCommandHandler(handler)).not.toThrow();
		});

		// 10. setCommandHandler replaceability
		it('setCommandHandler() can be called multiple times (replaces handler)', () => {
			const h1: PlatformCommandHandler = jest.fn();
			const h2: PlatformCommandHandler = jest.fn();
			platform.setCommandHandler(h1);
			expect(() => platform.setCommandHandler(h2)).not.toThrow();
		});
	});
}
