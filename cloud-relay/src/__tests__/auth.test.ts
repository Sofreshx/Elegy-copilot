import { buildGithubAuthUrl, normalizeScopes } from "../auth";

describe("auth helpers", () => {
  it("normalizes scopes with defaults", () => {
    expect(normalizeScopes(undefined)).toEqual(["read:user", "repo"]);
    expect(normalizeScopes("")).toEqual(["read:user", "repo"]);
    expect(normalizeScopes([""])).toEqual(["read:user", "repo"]);
    expect(normalizeScopes(["read:user", "repo"])).toEqual(["read:user", "repo"]);
    expect(normalizeScopes("read:user repo")).toEqual(["read:user", "repo"]);
  });

  it("builds a GitHub OAuth authorize URL", () => {
    const url = buildGithubAuthUrl({
      clientId: "client-123",
      redirectUri: "http://localhost:5173/auth/callback",
      scopes: ["read:user"],
      state: "state-abc",
    });

    expect(url).toContain("https://github.com/login/oauth/authorize?");
    expect(url).toContain("client_id=client-123");
    expect(url).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fauth%2Fcallback");
    expect(url).toContain("scope=read%3Auser");
    expect(url).toContain("state=state-abc");
  });
});
