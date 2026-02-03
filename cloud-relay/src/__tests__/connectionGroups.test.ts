import { GroupManager } from "../connectionGroups";

describe("GroupManager", () => {
  it("tracks join and leave with group cleanup", () => {
    const manager = new GroupManager();

    const joinResult = manager.joinGroup("client-1", "user", "user-123");
    expect(joinResult).toEqual({ success: true, memberCount: 1 });
    expect(manager.isClientInGroup("client-1", "user", "user-123")).toBe(true);
    expect(manager.getGroupMembers("user", "user-123")).toEqual(["client-1"]);

    const leaveResult = manager.leaveGroup("client-1", "user", "user-123");
    expect(leaveResult).toEqual({ success: true, memberCount: 0 });
    expect(manager.getGroup("user", "user-123")).toBeUndefined();
  });

  it("tracks client groups and stats", () => {
    const manager = new GroupManager();

    manager.joinGroup("client-1", "user", "user-123");
    manager.joinGroup("client-1", "workspace", "ws-1");
    manager.joinGroup("client-2", "workspace", "ws-1");

    const groups = manager.getClientGroups("client-1");
    const hasUserGroup = groups.some(
      (group) => group.groupType === "user" && group.groupId === "user-123"
    );
    const hasWorkspaceGroup = groups.some(
      (group) => group.groupType === "workspace" && group.groupId === "ws-1"
    );

    expect(hasUserGroup).toBe(true);
    expect(hasWorkspaceGroup).toBe(true);

    const stats = manager.getStats();
    expect(stats.totalGroups).toBe(2);
    expect(stats.userGroups).toBe(1);
    expect(stats.workspaceGroups).toBe(1);
    expect(stats.totalMemberships).toBe(3);
  });

  it("removes client from all groups", () => {
    const manager = new GroupManager();

    manager.joinGroup("client-1", "user", "user-123");
    manager.joinGroup("client-1", "session", "session-1");
    manager.joinGroup("client-2", "session", "session-1");

    manager.removeClientFromAllGroups("client-1");

    expect(manager.isClientInGroup("client-1", "user", "user-123")).toBe(false);
    expect(manager.isClientInGroup("client-1", "session", "session-1")).toBe(false);
    expect(manager.getGroupMembers("session", "session-1")).toEqual(["client-2"]);
  });
});
