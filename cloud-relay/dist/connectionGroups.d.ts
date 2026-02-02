/**
 * Connection Groups Manager
 * Manages connection groups by type (user, workspace, session)
 */
export type GroupType = "user" | "workspace" | "session";
export interface ConnectionGroup {
    groupId: string;
    groupType: GroupType;
    connections: Set<string>;
    createdAt: Date;
    metadata?: Record<string, unknown>;
}
export interface GroupMemberInfo {
    clientId: string;
    joinedAt: Date;
}
export declare class GroupManager {
    private groups;
    private clientGroups;
    /**
     * Generate composite key for a group
     */
    private getGroupKey;
    /**
     * Join a connection group
     */
    joinGroup(clientId: string, groupType: GroupType, groupId: string, metadata?: Record<string, unknown>): {
        success: boolean;
        memberCount: number;
    };
    /**
     * Leave a connection group
     */
    leaveGroup(clientId: string, groupType: GroupType, groupId: string): {
        success: boolean;
        memberCount: number;
    };
    /**
     * Remove client from all groups (on disconnect)
     */
    removeClientFromAllGroups(clientId: string): void;
    /**
     * Get all members of a group
     */
    getGroupMembers(groupType: GroupType, groupId: string): string[];
    /**
     * Get group info
     */
    getGroup(groupType: GroupType, groupId: string): ConnectionGroup | undefined;
    /**
     * Check if client is in a group
     */
    isClientInGroup(clientId: string, groupType: GroupType, groupId: string): boolean;
    /**
     * Get all groups a client belongs to
     */
    getClientGroups(clientId: string): Array<{
        groupType: GroupType;
        groupId: string;
    }>;
    /**
     * Get all groups by type
     */
    getGroupsByType(groupType: GroupType): ConnectionGroup[];
    /**
     * Get statistics about groups
     */
    getStats(): {
        totalGroups: number;
        userGroups: number;
        workspaceGroups: number;
        sessionGroups: number;
        totalMemberships: number;
    };
    /**
     * Clear all groups (for testing/shutdown)
     */
    clear(): void;
}
//# sourceMappingURL=connectionGroups.d.ts.map