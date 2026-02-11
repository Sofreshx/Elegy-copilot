import { TrackerAuth } from "../auth";

/** Helper: build a minimal valid JWT (unsigned, for structural validation only) */
function makeJwt(
  headerOverrides: Record<string, unknown> = {},
  payloadOverrides: Record<string, unknown> = {}
): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT", ...headerOverrides })
  ).toString("base64url");

  const payload = Buffer.from(
    JSON.stringify({
      sub: "tracker-test",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      ...payloadOverrides,
    })
  ).toString("base64url");

  const signature = Buffer.from("fake-signature").toString("base64url");

  return `${header}.${payload}.${signature}`;
}

describe("TrackerAuth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.TRACKER_RELAY_TOKEN;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("resolve()", () => {
    it("returns env token when TRACKER_RELAY_TOKEN is set", async () => {
      process.env.TRACKER_RELAY_TOKEN = "test-token-value";

      const auth = new TrackerAuth();
      const creds = await auth.resolve();

      expect(creds).not.toBeNull();
      expect(creds!.relayToken).toBe("test-token-value");
      expect(creds!.source).toBe("env");
    });

    it("returns null when no credentials are available", async () => {
      const auth = new TrackerAuth();
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();

      const creds = await auth.resolve();

      expect(creds).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("No relay credentials found")
      );

      warnSpy.mockRestore();
    });
  });

  describe("getCredentials()", () => {
    it("returns null before resolve() is called", () => {
      const auth = new TrackerAuth();
      expect(auth.getCredentials()).toBeNull();
    });

    it("returns last resolved credentials", async () => {
      process.env.TRACKER_RELAY_TOKEN = "my-token";

      const auth = new TrackerAuth();
      await auth.resolve();

      const creds = auth.getCredentials();
      expect(creds).not.toBeNull();
      expect(creds!.relayToken).toBe("my-token");
      expect(creds!.source).toBe("env");
    });
  });

  describe("validateToken()", () => {
    const auth = new TrackerAuth();

    it("accepts a valid JWT structure", () => {
      const token = makeJwt();
      expect(auth.validateToken(token)).toBe(true);
    });

    it("accepts a JWT with client_id instead of sub", () => {
      const token = makeJwt({}, { sub: undefined, client_id: "relay-client" });
      expect(auth.validateToken(token)).toBe(true);
    });

    it("rejects a plain string (not a JWT)", () => {
      expect(auth.validateToken("not-a-jwt")).toBe(false);
    });

    it("rejects a string with wrong number of parts", () => {
      expect(auth.validateToken("a.b")).toBe(false);
      expect(auth.validateToken("a.b.c.d")).toBe(false);
    });

    it("rejects a token with invalid base64 payload", () => {
      expect(auth.validateToken("x.y.z")).toBe(false);
    });

    it("rejects a token missing required header fields", () => {
      const token = makeJwt({ alg: undefined, typ: undefined });
      expect(auth.validateToken(token)).toBe(false);
    });

    it("rejects an expired token", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation();

      const token = makeJwt({}, { exp: Math.floor(Date.now() / 1000) - 60 });
      expect(auth.validateToken(token)).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Token has expired")
      );

      warnSpy.mockRestore();
    });

    it("accepts a token without an exp claim", () => {
      const token = makeJwt({}, { exp: undefined });
      expect(auth.validateToken(token)).toBe(true);
    });
  });
});
