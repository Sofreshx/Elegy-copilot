export const GATEWAY_CHILD_FLAG = '--elegy-copilot-gateway-child';

export function hasGatewayChildFlag(argv: readonly string[]): boolean {
  return argv.includes(GATEWAY_CHILD_FLAG);
}

export function buildPackagedGatewayChildArgs(): string[] {
  return [GATEWAY_CHILD_FLAG];
}

export function stripGatewayChildFlag(argv: readonly string[]): string[] {
  return argv.filter((value) => value !== GATEWAY_CHILD_FLAG);
}