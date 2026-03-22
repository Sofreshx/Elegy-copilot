'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  buildCatalogProjection,
  getEffectiveAsset,
  loadCatalogProjectionSnapshot,
  queryCatalogEntries,
  queryEffectiveCatalog,
  rebuildCatalogProjection,
  resolveProjectionStorage,
} = require('../lib/catalogProjectionService');

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS: ${name}`);
  } catch (error) {
    failed += 1;
    process.exitCode = 1;
    console.error(`  FAIL: ${name}`);
    console.error(`    ${error.message}`);
  }
}

function writeJson(absPath, value) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function writeText(absPath, text) {
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, text, 'utf8');
}

async function run() {
  console.log('\nCatalog Projection Service Tests\n');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-catalog-projection-'));
  const engineRoot = path.join(tmpRoot, 'engine');
  const copilotHome = path.join(tmpRoot, '.copilot');
  const repoPath = path.join(tmpRoot, 'workspace-repo');

  try {
    writeJson(path.join(engineRoot, 'engine-assets', 'manifest.json'), {
      bundles: [
        {
          id: 'core-global',
          title: 'Core Global Assets',
          assetIds: ['skill-core-guardrails', 'agent-code-reviewer'],
          installTarget: 'user-global',
          activationScope: 'global',
          materialization: 'always',
          classification: 'core',
          tags: ['core', 'global'],
        },
        {
          id: 'react-language-kit',
          title: 'React Language Kit',
          assetIds: ['skill-react-query'],
          installTarget: 'user-global',
          activationScope: 'global',
          materialization: 'on-demand',
          classification: 'language',
          targeting: {
            languages: ['typescript', 'javascript'],
            frameworks: ['react'],
            tags: ['frontend'],
          },
          tags: ['frontend'],
        },
      ],
      assets: [
        {
          id: 'skill-react-query',
          type: 'skill',
          source: 'engine-assets/skills/react-query',
          destination: 'skills/react-query',
          loadMode: 'on-demand',
        },
        {
          id: 'skill-core-guardrails',
          type: 'skill',
          source: 'engine-assets/skills/core-guardrails',
          destination: 'skills/core-guardrails',
          loadMode: 'always',
        },
        {
          id: 'agent-code-reviewer',
          type: 'agent',
          source: 'engine-assets/agents/code-reviewer.agent.md',
          destination: 'agents/code-reviewer.agent.md',
        },
      ],
    });

    writeJson(path.join(engineRoot, 'engine-assets', 'skills', 'skill-metadata-index.json'), {
      schemaVersion: 1,
      entries: [
        {
          skill: 'react-query',
          name: 'React Query',
          description: 'Shared React Query guidance from engine assets.',
          triggersOn: ['react query', 'tanstack query', 'query cache'],
          manifest: { loadMode: 'on-demand' },
        },
        {
          skill: 'core-guardrails',
          name: 'Core Guardrails',
          description: 'Always-loaded safety rules.',
          triggersOn: ['safety', 'terminal'],
          manifest: { loadMode: 'always' },
        },
      ],
    });

    writeText(
      path.join(engineRoot, 'engine-assets', 'skills', 'react-query', 'SKILL.md'),
      '# React Query\n\nSource React Query skill.\n\nTriggers on: react query, tanstack query\n',
    );
    writeText(
      path.join(engineRoot, 'engine-assets', 'skills', 'core-guardrails', 'SKILL.md'),
      '# Core Guardrails\n\nSource guardrails skill.\n',
    );
    writeText(
      path.join(engineRoot, 'engine-assets', 'agents', 'code-reviewer.agent.md'),
      '# Code Reviewer\n\nShipped review agent.\n',
    );

    writeText(
      path.join(copilotHome, 'skills', 'react-query', 'SKILL.md'),
      [
        '---',
        'schema-version: 1',
        'vault-ref: skills-vault/react-query',
        '---',
        '# React Query Pointer',
        'Pointer stub for the vault skill.',
        '',
      ].join('\n'),
    );
    writeText(
      path.join(copilotHome, 'skills-vault', 'react-query', 'SKILL.md'),
      '# React Query Vault\n\nVault-backed React Query guidance.\n',
    );
    writeText(
      path.join(copilotHome, 'skills', 'core-guardrails', 'SKILL.md'),
      '# Core Guardrails Installed\n\nInstalled always-on guardrails.\n',
    );
    writeText(
      path.join(copilotHome, 'agents', 'code-reviewer.agent.md'),
      '# Code Reviewer Installed\n\nInstalled review agent.\n',
    );
    writeText(
      path.join(
        copilotHome,
        'marketplace-cache',
        'dwaintr-superpowers-copilot',
        'plugins',
        'superpowers',
        'agents',
        'code-reviewer.md',
      ),
      [
        '---',
        'name: code-reviewer',
        'description: Plugin-installed external reviewer.',
        'model: inherit',
        '---',
        '',
        '# Code Reviewer',
        '',
        'External plugin review agent.',
        '',
      ].join('\n'),
    );
    let pluginAgentWasLinked = false;
    try {
      fs.mkdirSync(path.join(copilotHome, 'agents'), { recursive: true });
      fs.symlinkSync(
        path.join(
          copilotHome,
          'marketplace-cache',
          'dwaintr-superpowers-copilot',
          'plugins',
          'superpowers',
          'agents',
          'code-reviewer.md',
        ),
        path.join(copilotHome, 'agents', 'code-reviewer.md'),
        'file',
      );
      pluginAgentWasLinked = true;
    } catch {
      writeText(
        path.join(copilotHome, 'agents', 'code-reviewer.md'),
        [
          '---',
          'name: code-reviewer',
          'description: Plugin-installed external reviewer.',
          'model: inherit',
          '---',
          '',
          '# Code Reviewer',
          '',
          'External plugin review agent.',
          '',
        ].join('\n'),
      );
    }
    writeText(
      path.join(copilotHome, 'skills', 'superpowers', 'brainstorming', 'SKILL.md'),
      [
        '---',
        'name: brainstorming',
        'description: External plugin brainstorming skill.',
        '---',
        '# Brainstorming',
        '',
        'External plugin brainstorming workflow.',
        '',
      ].join('\n'),
    );
    writeText(
      path.join(copilotHome, 'skills', 'providers', 'superpowers', 'workflow-kit', 'SKILL.md'),
      [
        '---',
        'name: workflow-kit',
        'description: Managed-import provider workflow kit.',
        '---',
        '# Workflow Kit',
        '',
        'Managed import workflow kit.',
        '',
      ].join('\n'),
    );
    writeText(
      path.join(copilotHome, 'skills', 'operations', 'release-drill', 'index.md'),
      [
        '---',
        'name: release-drill',
        'description: Namespaced user-installed drill playbook.',
        '---',
        '# Release Drill',
        '',
        'Practice release recovery steps.',
        '',
      ].join('\n'),
    );
    writeText(
      path.join(copilotHome, 'skills-vault', 'providers', 'superpowers', 'incident-kit', 'index.md'),
      [
        '---',
        'name: incident-kit',
        'description: Vault-only managed-import incident kit.',
        '---',
        '# Incident Kit',
        '',
        'Managed import incident response kit.',
        '',
      ].join('\n'),
    );
    writeText(
      path.join(copilotHome, 'agents', 'providers--superpowers--workflow-guide.md'),
      [
        '---',
        'name: workflow-guide',
        'description: Managed-import provider guide agent.',
        'model: inherit',
        '---',
        '',
        '# Workflow Guide',
        '',
        'Managed import provider guide.',
        '',
      ].join('\n'),
    );

    writeText(
      path.join(repoPath, '.github', 'skills', 'react-query', 'SKILL.md'),
      '# Repo React Query\n\nRepo-local override for this workspace.\n',
    );
    writeText(
      path.join(repoPath, '.github', 'skills', 'providers', 'superpowers', 'repo-kit', 'index.md'),
      '# Repo Kit\n\nRepo-local managed-import provider kit.\n',
    );
    writeText(
      path.join(repoPath, '.github', 'agents', 'code-reviewer.agent.md'),
      '# Repo Code Reviewer\n\nRepo-local reviewer override.\n',
    );

    const repoStorage = resolveProjectionStorage({ copilotHome, repoPath });
    writeJson(path.join(copilotHome, 'repo-state', repoStorage.repoContext.repoId, 'registry.json'), {
      skills: {
        disabled: ['react-query'],
      },
    });

    await test('buildCatalogProjection composes source, user, vault, repo-local, and overlay layers', async () => {
      const snapshot = buildCatalogProjection({ engineRoot, copilotHome, repoPath });

      assert.ok(Array.isArray(snapshot.entries));
      assert.ok(Array.isArray(snapshot.effectiveAssets));
      assert.strictEqual(snapshot.repoContext.repoPath, repoPath);

      const reactQueryEntries = queryCatalogEntries(snapshot, {
        assetId: 'skill-react-query',
      });
      assert.deepStrictEqual(
        reactQueryEntries.map((entry) => entry.layer),
        ['source', 'user-installed', 'vault-only', 'repo-local', 'repo-state-overlay'],
      );

      const reactQuery = getEffectiveAsset(snapshot, 'skill-react-query');
      assert.ok(reactQuery, 'expected effective React Query state');
      assert.strictEqual(reactQuery.selectedLayer, 'repo-local');
      assert.strictEqual(reactQuery.enabled, false);
      assert.strictEqual(reactQuery.installed, true);
      assert.strictEqual(reactQuery.overridden, true);
      assert.ok(reactQuery.labels.includes('disabled'));
      assert.ok(reactQuery.labels.includes('overridden'));
      assert.ok(
        reactQuery.reasons.some((reason) => reason.code === 'repo-overlay-disabled'),
        'expected repo overlay disable reason',
      );
      assert.strictEqual(
        reactQuery.installState.installedPaths['vault-only'],
        path.join(copilotHome, 'skills-vault', 'react-query', 'SKILL.md'),
      );
      assert.strictEqual(
        reactQuery.installState.installedPaths['repo-local'],
        path.join(repoPath, '.github', 'skills', 'react-query', 'SKILL.md'),
      );

      const repoAgent = getEffectiveAsset(snapshot, 'agent-code-reviewer');
      assert.ok(repoAgent, 'expected repo-local agent state');
      assert.strictEqual(repoAgent.selectedLayer, 'repo-local');
      assert.strictEqual(repoAgent.enabled, true);
      assert.strictEqual(repoAgent.selectedEntry.title, 'Repo Code Reviewer');

      const coreBundle = snapshot.bundles.find((bundle) => bundle.bundleId === 'core-global');
      assert.ok(coreBundle, 'expected core bundle projection');
      assert.strictEqual(coreBundle.classification, 'core');
      assert.strictEqual(coreBundle.defaultMemberLoadMode, 'always');
      assert.deepStrictEqual(coreBundle.targeting, {
        tags: ['core', 'global'],
      });
      assert.deepStrictEqual(coreBundle.uninstallPolicy, {
        removesInstalledMembers: true,
        clearsActivationState: true,
        clearsRepoOverlayState: true,
        preservesExternalPackages: true,
      });

      const languageBundle = snapshot.bundles.find((bundle) => bundle.bundleId === 'react-language-kit');
      assert.ok(languageBundle, 'expected language bundle projection');
      assert.strictEqual(languageBundle.classification, 'language');
      assert.deepStrictEqual(languageBundle.targeting, {
        frameworks: ['react'],
        languages: ['typescript', 'javascript'],
        tags: ['frontend'],
      });
      assert.strictEqual(languageBundle.defaultMemberLoadMode, null);

      const pluginAgent = snapshot.effectiveAssets.find(
        (asset) => asset.selectedEntry?.metadata?.logicalName === 'code-reviewer' && asset.assetId !== 'agent-code-reviewer',
      );
      assert.ok(pluginAgent, 'expected plugin agent to be projected separately');
      assert.strictEqual(pluginAgent.selectedLayer, 'user-installed');
      assert.strictEqual(pluginAgent.selectedEntry.metadata.logicalName, 'code-reviewer');
      assert.strictEqual(pluginAgent.selectedEntry.metadata.readOnly, true);
      if (pluginAgentWasLinked) {
        assert.strictEqual(pluginAgent.selectedEntry.metadata.provider, 'superpowers-copilot');
        assert.strictEqual(pluginAgent.selectedEntry.provenance.providerId, 'superpowers-copilot');
        assert.strictEqual(pluginAgent.selectedEntry.provenance.discoveryMode, 'compatibility-bridge');
        assert.strictEqual(pluginAgent.selectedEntry.metadata.namespace, 'superpowers');
        assert.strictEqual(pluginAgent.selectedEntry.metadata.sourcePackage, 'dwaintr-superpowers-copilot');
      } else {
        assert.strictEqual(pluginAgent.selectedEntry.metadata.provider, 'copilot-home-plain-agent');
      }

      const pluginSkill = snapshot.effectiveAssets.find(
        (asset) => asset.selectedEntry?.metadata?.viewPath === 'skills/superpowers/brainstorming/SKILL.md',
      );
      assert.ok(pluginSkill, 'expected plugin skill to be projected');
      assert.strictEqual(pluginSkill.kind, 'skill');
      assert.strictEqual(pluginSkill.selectedLayer, 'user-installed');
      assert.strictEqual(pluginSkill.selectedEntry.metadata.logicalName, 'brainstorming');
      assert.strictEqual(pluginSkill.selectedEntry.metadata.viewPath, 'skills/superpowers/brainstorming/SKILL.md');
      assert.strictEqual(pluginSkill.selectedEntry.metadata.readOnly, true);
      assert.strictEqual(pluginSkill.selectedEntry.metadata.provider, 'superpowers-copilot');
      assert.strictEqual(pluginSkill.selectedEntry.provenance.providerId, 'superpowers-copilot');
      assert.strictEqual(pluginSkill.selectedEntry.provenance.discoveryMode, 'compatibility-bridge');

      const importedProviderSkill = snapshot.effectiveAssets.find(
        (asset) => asset.selectedEntry?.metadata?.viewPath === 'skills/providers/superpowers/workflow-kit/SKILL.md',
      );
      assert.ok(importedProviderSkill, 'expected managed-import provider skill to be projected');
      assert.strictEqual(importedProviderSkill.selectedEntry.provenance.providerId, 'superpowers-copilot');
      assert.strictEqual(importedProviderSkill.selectedEntry.provenance.discoveryMode, 'managed-import');
      assert.strictEqual(importedProviderSkill.selectedEntry.provenance.originKind, 'provider-import');

      const namespacedIndexSkill = snapshot.effectiveAssets.find(
        (asset) => asset.selectedEntry?.metadata?.viewPath === 'skills/operations/release-drill/index.md',
      );
      assert.ok(namespacedIndexSkill, 'expected namespaced index.md skill to be projected');
      assert.strictEqual(namespacedIndexSkill.selectedLayer, 'user-installed');
      assert.strictEqual(namespacedIndexSkill.selectedEntry.metadata.logicalName, 'release-drill');
      assert.strictEqual(namespacedIndexSkill.selectedEntry.metadata.namespace, 'operations');
      assert.strictEqual(namespacedIndexSkill.selectedEntry.metadata.provider, 'copilot-home-plugin');
      assert.strictEqual(namespacedIndexSkill.selectedEntry.metadata.readOnly, true);
      assert.strictEqual(namespacedIndexSkill.selectedEntry.provenance.providerId, 'copilot-home-plugin');
      assert.strictEqual(namespacedIndexSkill.selectedEntry.provenance.discoveryMode, 'compatibility-bridge');

      const vaultedProviderIndexSkill = snapshot.effectiveAssets.find(
        (asset) => asset.selectedEntry?.metadata?.viewPath === 'skills-vault/providers/superpowers/incident-kit/index.md',
      );
      assert.ok(vaultedProviderIndexSkill, 'expected vault provider index.md skill to be projected');
      assert.strictEqual(vaultedProviderIndexSkill.selectedLayer, 'vault-only');
      assert.strictEqual(vaultedProviderIndexSkill.selectedEntry.metadata.provider, 'superpowers-copilot');
      assert.strictEqual(vaultedProviderIndexSkill.selectedEntry.metadata.readOnly, true);
      assert.strictEqual(vaultedProviderIndexSkill.selectedEntry.provenance.providerId, 'superpowers-copilot');
      assert.strictEqual(vaultedProviderIndexSkill.selectedEntry.provenance.discoveryMode, 'managed-import');

      const repoProviderIndexSkill = snapshot.effectiveAssets.find(
        (asset) => asset.selectedEntry?.metadata?.viewPath === '.github/skills/providers/superpowers/repo-kit/index.md',
      );
      assert.ok(repoProviderIndexSkill, 'expected repo-local provider index.md skill to be projected');
      assert.strictEqual(repoProviderIndexSkill.selectedLayer, 'repo-local');
      assert.strictEqual(repoProviderIndexSkill.selectedEntry.metadata.provider, 'superpowers-copilot');
      assert.strictEqual(repoProviderIndexSkill.selectedEntry.metadata.readOnly, true);
      assert.strictEqual(repoProviderIndexSkill.selectedEntry.provenance.providerId, 'superpowers-copilot');
      assert.strictEqual(repoProviderIndexSkill.selectedEntry.provenance.discoveryMode, 'managed-import');

      const importedProviderAgent = snapshot.effectiveAssets.find(
        (asset) => asset.selectedEntry?.metadata?.logicalName === 'workflow-guide',
      );
      assert.ok(importedProviderAgent, 'expected managed-import provider agent to be projected');
      assert.strictEqual(importedProviderAgent.selectedEntry.provenance.providerId, 'superpowers-copilot');
      assert.strictEqual(importedProviderAgent.selectedEntry.provenance.discoveryMode, 'managed-import');

      const providerRecord = snapshot.providers.find((provider) => provider.providerId === 'superpowers-copilot');
      assert.ok(providerRecord, 'expected provider record in projection');
      assert.ok(providerRecord.discoveredAssets.count >= 3, 'expected provider asset rollup');

      const disabledSkills = queryEffectiveCatalog(snapshot, {
        kind: 'skill',
        enabled: false,
      });
      assert.deepStrictEqual(disabledSkills.map((entry) => entry.assetId), ['skill-react-query']);
    });

    await test('rebuildCatalogProjection persists and reloads filesystem-derived snapshot data', async () => {
      const snapshot = rebuildCatalogProjection({ engineRoot, copilotHome });
      const persisted = loadCatalogProjectionSnapshot({ copilotHome });

      assert.ok(fs.existsSync(snapshot.storage.snapshotPath), 'expected projection snapshot to be written');
      assert.ok(persisted, 'expected persisted snapshot to load');
      assert.strictEqual(persisted.stats.entryCount, snapshot.stats.entryCount);
      assert.strictEqual(persisted.repoContext, null);

      const reactQuery = getEffectiveAsset(persisted, 'skill-react-query');
      assert.ok(reactQuery, 'expected persisted React Query state');
      assert.strictEqual(reactQuery.selectedLayer, 'vault-only');
      assert.strictEqual(reactQuery.enabled, true);
      assert.ok(
        reactQuery.reasons.some((reason) => reason.code === 'vault-preferred-over-pointer'),
        'expected vault-preferred-over-pointer reason after reload',
      );

      const textResults = queryEffectiveCatalog(persisted, {
        kind: 'skill',
        text: 'tanstack query',
      });
      assert.deepStrictEqual(textResults.map((entry) => entry.assetId), ['skill-react-query']);

      const sourceOnlySkill = getEffectiveAsset(persisted, 'skill-core-guardrails');
      assert.ok(sourceOnlySkill, 'expected always skill state');
      assert.strictEqual(sourceOnlySkill.selectedLayer, 'user-installed');
      assert.strictEqual(sourceOnlySkill.enabled, true);
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log(`\n  ${passed} passed, ${failed} failed (${passed + failed} total)\n`);
}

run().catch((error) => {
  console.error(`\n  FATAL: ${error.message}\n`);
  process.exitCode = 1;
});
