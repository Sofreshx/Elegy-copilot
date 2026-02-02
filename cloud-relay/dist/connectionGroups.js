"use strict";
/**
 * Connection Groups Manager
 * Manages connection groups by type (user, workspace, session)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupManager = void 0;
class GroupManager {
    // Map of "groupType:groupId" -> ConnectionGroup
    groups = new Map();
    // Reverse index: clientId -> Set of "groupType:groupId" keys
    clientGroups = new Map();
    /**
     * Generate composite key for a group
     */
    getGroupKey(groupType, groupId) {
        return `${groupType}:${groupId}`;
    }
    /**
     * Join a connection group
     */
    joinGroup(clientId, groupType, groupId, metadata) {
        const key = this.getGroupKey(groupType, groupId);
        // Get or create group
        let group = this.groups.get(key);
        if (!group) {
            group = {
                groupId,
                groupType,
                connections: new Set(),
                createdAt: new Date(),
                metadata,
            };
            this.groups.set(key, group);
        }
        // Add client to group
        group.connections.add(clientId);
        // Track in reverse index
        if (!this.clientGroups.has(clientId)) {
            this.clientGroups.set(clientId, new Set());
        }
        this.clientGroups.get(clientId).add(key);
        console.log(`[GroupManager] Client ${clientId} joined group ${groupType}:${groupId} (${group.connections.size} members)`);
        return {
            success: true,
            memberCount: group.connections.size,
        };
    }
    /**
     * Leave a connection group
     */
    leaveGroup(clientId, groupType, groupId) {
        const key = this.getGroupKey(groupType, groupId);
        const group = this.groups.get(key);
        if (!group) {
            return { success: false, memberCount: 0 };
        }
        // Remove client from group
        group.connections.delete(clientId);
        // Remove from reverse index
        const clientGroupSet = this.clientGroups.get(clientId);
        if (clientGroupSet) {
            clientGroupSet.delete(key);
            if (clientGroupSet.size === 0) {
                this.clientGroups.delete(clientId);
            }
        }
        // Delete empty groups
        if (group.connections.size === 0) {
            this.groups.delete(key);
            console.log(`[GroupManager] Group ${groupType}:${groupId} deleted (empty)`);
        }
        else {
            console.log(`[GroupManager] Client ${clientId} left group ${groupType}:${groupId} (${group.connections.size} members)`);
        }
        return {
            success: true,
            memberCount: group.connections.size,
        };
    }
    /**
     * Remove client from all groups (on disconnect)
     */
    removeClientFromAllGroups(clientId) {
        const clientGroupSet = this.clientGroups.get(clientId);
        if (!clientGroupSet)
            return;
        for (const key of clientGroupSet) {
            const group = this.groups.get(key);
            if (group) {
                group.connections.delete(clientId);
                if (group.connections.size === 0) {
                    this.groups.delete(key);
                }
            }
        }
        this.clientGroups.delete(clientId);
        console.log(`[GroupManager] Client ${clientId} removed from all groups`);
    }
    /**
     * Get all members of a group
     */
    getGroupMembers(groupType, groupId) {
        const key = this.getGroupKey(groupType, groupId);
        const group = this.groups.get(key);
        return group ? Array.from(group.connections) : [];
    }
    /**
     * Get group info
     */
    getGroup(groupType, groupId) {
        const key = this.getGroupKey(groupType, groupId);
        return this.groups.get(key);
    }
    /**
     * Check if client is in a group
     */
    isClientInGroup(clientId, groupType, groupId) {
        const key = this.getGroupKey(groupType, groupId);
        const group = this.groups.get(key);
        return group ? group.connections.has(clientId) : false;
    }
    /**
     * Get all groups a client belongs to
     */
    getClientGroups(clientId) {
        const clientGroupSet = this.clientGroups.get(clientId);
        if (!clientGroupSet)
            return [];
        return Array.from(clientGroupSet).map((key) => {
            const [groupType, groupId] = key.split(":", 2);
            return { groupType: groupType, groupId };
        });
    }
    /**
     * Get all groups by type
     */
    getGroupsByType(groupType) {
        const result = [];
        for (const [key, group] of this.groups) {
            if (key.startsWith(`${groupType}:`)) {
                result.push(group);
            }
        }
        return result;
    }
    /**
     * Get statistics about groups
     */
    getStats() {
        let userGroups = 0;
        let workspaceGroups = 0;
        let sessionGroups = 0;
        let totalMemberships = 0;
        for (const [key, group] of this.groups) {
            if (key.startsWith("user:"))
                userGroups++;
            else if (key.startsWith("workspace:"))
                workspaceGroups++;
            else if (key.startsWith("session:"))
                sessionGroups++;
            totalMemberships += group.connections.size;
        }
        return {
            totalGroups: this.groups.size,
            userGroups,
            workspaceGroups,
            sessionGroups,
            totalMemberships,
        };
    }
    /**
     * Clear all groups (for testing/shutdown)
     */
    clear() {
        this.groups.clear();
        this.clientGroups.clear();
    }
}
exports.GroupManager = GroupManager;
//# sourceMappingURL=connectionGroups.js.map