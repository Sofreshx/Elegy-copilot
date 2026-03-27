import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveSyncedNoteSourceId } from '@elegy-copilot/contracts';
import { SyncedNoteSourceStore, SyncedNoteSourceStoreError } from '../syncedNotes/syncedNoteSourceStore';

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

    it('keeps github primary while explicitly supporting gitea and git fallback providers', () => {
        const store = new SyncedNoteSourceStore({ sourcesDir: tmpDir });

        const githubSource = store.create({
            provider: 'github',
            host: 'github.com',
            owner: 'InstructionEngine',
            repo: 'workspace',
            branch: 'main',
            notesPath: 'docs/planning/github.md',
        });
        const giteaSource = store.create({
            provider: 'gitea',
            host: 'git.example.test',
            owner: 'team-planning',
            repo: 'tracker',
            branch: 'main',
            notesPath: 'notes/gitea.md',
        });
        const gitSource = store.create({
            provider: 'git',
            host: 'git.internal.test',
            owner: 'team-notes',
            repo: 'planning',
            branch: 'main',
            notesPath: 'notes/git.md',
        });

        expect(store.list()).toEqual(expect.arrayContaining([githubSource, giteaSource, gitSource]));
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

    it('rejects malformed payload ids with a deterministic store error', () => {
        const store = new SyncedNoteSourceStore({ sourcesDir: tmpDir });

        let thrown: unknown;
        try {
            store.create({
                id: 'snsrc_invalid',
                provider: 'github',
                host: 'github.com',
                owner: 'InstructionEngine',
                repo: 'workspace',
                branch: 'main',
                notesPath: 'docs/planning/seed.md',
            });
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(SyncedNoteSourceStoreError);
        expect(thrown).toMatchObject({
            statusCode: 400,
            code: 'invalid_synced_note_source_id',
            message: 'Synced-note source id must match snsrc_<32 lowercase hex characters>',
        });
    });

    it('rejects create payload ids that drift from the canonical locator', () => {
        const store = new SyncedNoteSourceStore({ sourcesDir: tmpDir });
        const mismatchedId = deriveSyncedNoteSourceId({
            provider: 'github',
            host: 'github.com',
            owner: 'InstructionEngine',
            repo: 'workspace',
            branch: 'main',
            notesPath: 'docs/planning/other.md',
        });

        let thrown: unknown;
        try {
            store.create({
                id: mismatchedId,
                provider: 'github',
                host: 'github.com',
                owner: 'InstructionEngine',
                repo: 'workspace',
                branch: 'main',
                notesPath: 'docs/planning/seed.md',
            });
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(SyncedNoteSourceStoreError);
        expect(thrown).toMatchObject({
            statusCode: 400,
            code: 'synced_note_source_locator_mismatch',
            message: 'Payload id does not match locator',
        });
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