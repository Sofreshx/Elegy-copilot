import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveSyncedNoteSourceId } from '@elegy-copilot/contracts';
import { SyncedNoteSourceStore } from '../syncedNotes/syncedNoteSourceStore';

describe('SyncedNoteSourceStore', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synced-note-store-'));
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('create/load/list roundtrip persists canonical synced-note source records', () => {
        const store = new SyncedNoteSourceStore({ sourcesDir: tmpDir });

        const created = store.create({
            provider: 'github',
            host: 'GitHub.COM',
            owner: 'InstructionEngine',
            repo: 'workspace',
            branch: 'main',
            notesPath: '.\\docs\\planning\\synced-note.md',
            localCheckoutPath: 'C:\\Repos\\instruction-engine',
        });

        expect(created).toMatchObject({
            provider: 'github',
            host: 'github.com',
            owner: 'InstructionEngine',
            repo: 'workspace',
            branch: 'main',
            notesPath: 'docs/planning/synced-note.md',
            localCheckoutPath: 'C:\\Repos\\instruction-engine',
        });
        expect(created.id).toBe(deriveSyncedNoteSourceId({
            provider: 'github',
            host: 'github.com',
            owner: 'InstructionEngine',
            repo: 'workspace',
            branch: 'main',
            notesPath: 'docs/planning/synced-note.md',
        }));
        expect(store.load(created.id)).toEqual(created);
        expect(store.list()).toEqual([created]);
    });

    it('update preserves the deterministic id and original createdAt timestamp', () => {
        const store = new SyncedNoteSourceStore({ sourcesDir: tmpDir });
        const created = store.create({
            provider: 'gitea',
            host: 'git.example.test',
            owner: 'team-planning',
            repo: 'tracker',
            branch: 'main',
            notesPath: 'notes/seed.md',
        });

        const updated = store.update(created.id, {
            id: created.id,
            provider: 'gitea',
            host: 'git.example.test',
            owner: 'team-planning',
            repo: 'tracker',
            branch: 'main',
            notesPath: 'notes/seed.md',
            localCheckoutPath: 'C:\\Repos\\tracker',
        });

        expect(updated.id).toBe(created.id);
        expect(updated.createdAt).toBe(created.createdAt);
        expect(updated.updatedAt >= created.updatedAt).toBe(true);
        expect(updated.localCheckoutPath).toBe('C:\\Repos\\tracker');
    });

    it('fails closed when an update payload derives a different deterministic id', () => {
        const store = new SyncedNoteSourceStore({ sourcesDir: tmpDir });
        const created = store.create({
            provider: 'git',
            host: 'git.internal.test',
            owner: 'team-notes',
            repo: 'planning',
            branch: 'main',
            notesPath: 'notes/team.md',
        });

        expect(() => store.update(created.id, {
            id: created.id,
            provider: 'git',
            host: 'git.internal.test',
            owner: 'team-notes',
            repo: 'planning',
            branch: 'feature/synced-note',
            notesPath: 'notes/team.md',
        })).toThrow('Payload locator does not match route id');
    });

    it('delete removes persisted synced-note sources', () => {
        const store = new SyncedNoteSourceStore({ sourcesDir: tmpDir });
        const created = store.create({
            provider: 'github',
            host: 'github.com',
            owner: 'InstructionEngine',
            repo: 'workspace',
            branch: 'main',
            notesPath: 'notes/delete-me.md',
        });

        expect(store.delete(created.id)).toBe(true);
        expect(store.load(created.id)).toBeUndefined();
        expect(store.list()).toEqual([]);
    });
});