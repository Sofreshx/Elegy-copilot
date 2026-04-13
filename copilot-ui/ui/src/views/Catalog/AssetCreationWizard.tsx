import { Button, FormInput, Panel, SteppedWizard } from '../../components';
import { useStoreValue } from '../../lib/store';
import { navigationStore } from '../../stores/navigation';
import { assetCreationStore } from './assetCreationStore';
import type { AssetCreationState } from './assetCreationStore';

// ── Templates ──

function getAgentTemplate(state: AssetCreationState): string {
  return `---
name: ${state.assetKey || 'my-agent'}
description: "${state.description || 'A custom agent'}"
---

# ${state.title || 'My Agent'}

## Purpose

Describe what this agent does.

## Instructions

- Follow project conventions
- Use available tools effectively

## Tools

This agent has access to standard development tools.
`;
}

function getSkillTemplate(state: AssetCreationState): string {
  return `---
name: ${state.assetKey || 'my-skill'}
description: "${state.description || 'A custom skill'}"
---

# ${state.title || 'My Skill'}

## Purpose

Describe what this skill provides.

## Instructions

Step-by-step guidance for the domain this skill covers.
`;
}

// ── Step 1: Kind & Scope ──

function KindStep({ state }: { state: AssetCreationState }) {
  return (
    <div className="asset-wizard-step" data-testid="asset-wizard-kind-step">
      <Panel title="Asset Kind" subtitle="Choose what type of asset to create." testId="asset-wizard-kind-panel">
        <div className="asset-wizard-card-row" data-testid="asset-wizard-kind-options">
          <button
            type="button"
            className={`asset-wizard-option-card ${state.kind === 'agent' ? 'asset-wizard-option-card-selected' : ''}`}
            data-testid="asset-wizard-kind-agent"
            onClick={() => assetCreationStore.setKind('agent')}
          >
            <span className="asset-wizard-option-icon">🤖</span>
            <span className="asset-wizard-option-label">Agent</span>
            <span className="asset-wizard-option-desc">An AI agent with instructions and tool access</span>
          </button>
          <button
            type="button"
            className={`asset-wizard-option-card ${state.kind === 'skill' ? 'asset-wizard-option-card-selected' : ''}`}
            data-testid="asset-wizard-kind-skill"
            onClick={() => assetCreationStore.setKind('skill')}
          >
            <span className="asset-wizard-option-icon">⚡</span>
            <span className="asset-wizard-option-label">Skill</span>
            <span className="asset-wizard-option-desc">A reusable skill with triggers and load modes</span>
          </button>
        </div>
      </Panel>

      <Panel title="Authoring Scope" subtitle="Where this asset will be stored." testId="asset-wizard-scope-panel">
        <div className="asset-wizard-card-row" data-testid="asset-wizard-scope-options">
          <button
            type="button"
            className={`asset-wizard-option-card ${state.authoringScope === 'shared' ? 'asset-wizard-option-card-selected' : ''}`}
            data-testid="asset-wizard-scope-shared"
            onClick={() => assetCreationStore.setAuthoringScope('shared')}
          >
            <span className="asset-wizard-option-icon">🌐</span>
            <span className="asset-wizard-option-label">Shared</span>
            <span className="asset-wizard-option-desc">Available across all users and repositories</span>
          </button>
          <button
            type="button"
            className={`asset-wizard-option-card ${state.authoringScope === 'user-global' ? 'asset-wizard-option-card-selected' : ''}`}
            data-testid="asset-wizard-scope-user-global"
            onClick={() => assetCreationStore.setAuthoringScope('user-global')}
          >
            <span className="asset-wizard-option-icon">👤</span>
            <span className="asset-wizard-option-label">User Global</span>
            <span className="asset-wizard-option-desc">Available to you across all repositories</span>
          </button>
          <button
            type="button"
            className={`asset-wizard-option-card ${state.authoringScope === 'repo-local' ? 'asset-wizard-option-card-selected' : ''}`}
            data-testid="asset-wizard-scope-repo-local"
            onClick={() => assetCreationStore.setAuthoringScope('repo-local')}
          >
            <span className="asset-wizard-option-icon">📁</span>
            <span className="asset-wizard-option-label">Repo Local</span>
            <span className="asset-wizard-option-desc">Scoped to a specific repository</span>
          </button>
        </div>

        {state.authoringScope === 'repo-local' ? (
          <FormInput
            label="Repository path"
            placeholder="/path/to/repository"
            value={state.repoPath}
            onValueChange={(v) => assetCreationStore.setRepoPath(v)}
            testId="asset-wizard-repo-path"
          />
        ) : null}
      </Panel>
    </div>
  );
}

// ── Step 2: Identity ──

function IdentityStep({ state }: { state: AssetCreationState }) {
  const keyHasSpaces = /\s/.test(state.assetKey);

  return (
    <div className="asset-wizard-step" data-testid="asset-wizard-identity-step">
      <Panel
        title="Asset Identity"
        subtitle="Give your asset a name and description. The asset key auto-generates from the title."
        testId="asset-wizard-identity-panel"
      >
        <FormInput
          label="Title"
          placeholder="e.g. Code Review Helper"
          value={state.title}
          onValueChange={(v) => assetCreationStore.setTitle(v)}
          testId="asset-wizard-title"
        />

        <div className="asset-wizard-field-group">
          <FormInput
            label="Asset key (slug)"
            placeholder="e.g. code-review-helper"
            value={state.assetKey}
            onValueChange={(v) => assetCreationStore.setAssetKey(v)}
            testId="asset-wizard-key"
          />
          {keyHasSpaces ? (
            <p className="asset-wizard-validation-error" data-testid="asset-wizard-key-error">
              Asset key must not contain spaces.
            </p>
          ) : null}
          {!state.assetKey.trim() ? (
            <p className="asset-wizard-validation-hint" data-testid="asset-wizard-key-hint">
              Asset key is required. Type a title to auto-generate it.
            </p>
          ) : null}
        </div>

        <div className="asset-wizard-field-group">
          <label className="form-input" data-testid="asset-wizard-description" htmlFor="asset-wizard-description-control">
            <span className="form-label">Description</span>
            <textarea
              id="asset-wizard-description-control"
              data-testid="asset-wizard-description-control"
              className="form-textarea"
              placeholder="Describe what this asset does..."
              rows={3}
              value={state.description}
              onChange={(e) => assetCreationStore.setDescription(e.target.value)}
            />
          </label>
        </div>
      </Panel>
    </div>
  );
}

// ── Step 3: Content ──

function ContentStep({ state }: { state: AssetCreationState }) {
  const template = state.kind === 'agent' ? getAgentTemplate(state) : getSkillTemplate(state);

  return (
    <div className="asset-wizard-step" data-testid="asset-wizard-content-step">
      <Panel
        title="Content"
        subtitle={`Write or paste your ${state.kind} instruction content in markdown.`}
        testId="asset-wizard-content-panel"
      >
        <div className="asset-wizard-content-actions">
          <Button
            onClick={() => assetCreationStore.setContent(template)}
            testId="asset-wizard-use-template"
            variant="secondary"
            size="sm"
          >
            Use template
          </Button>
        </div>

        <label className="form-input" data-testid="asset-wizard-content" htmlFor="asset-wizard-content-control">
          <span className="form-label">{state.kind === 'agent' ? 'Agent instructions' : 'Skill content'}</span>
          <textarea
            id="asset-wizard-content-control"
            data-testid="asset-wizard-content-control"
            className="form-textarea code-block"
            placeholder={`Paste or write your ${state.kind} content here...`}
            rows={16}
            value={state.content}
            onChange={(e) => assetCreationStore.setContent(e.target.value)}
          />
        </label>
      </Panel>

      {state.kind === 'skill' ? (
        <Panel title="Skill Settings" subtitle="Configure load mode and trigger conditions." testId="asset-wizard-skill-settings-panel">
          <div className="asset-wizard-card-row" data-testid="asset-wizard-load-mode-options">
            <button
              type="button"
              className={`asset-wizard-option-card ${state.loadMode === 'always' ? 'asset-wizard-option-card-selected' : ''}`}
              data-testid="asset-wizard-load-mode-always"
              onClick={() => assetCreationStore.setLoadMode('always')}
            >
              <span className="asset-wizard-option-label">Always</span>
              <span className="asset-wizard-option-desc">Loaded in every session automatically</span>
            </button>
            <button
              type="button"
              className={`asset-wizard-option-card ${state.loadMode === 'on-demand' ? 'asset-wizard-option-card-selected' : ''}`}
              data-testid="asset-wizard-load-mode-on-demand"
              onClick={() => assetCreationStore.setLoadMode('on-demand')}
            >
              <span className="asset-wizard-option-label">On-demand</span>
              <span className="asset-wizard-option-desc">Loaded only when triggered or requested</span>
            </button>
          </div>

          <FormInput
            label="Triggers on (comma-separated)"
            placeholder="e.g. file-change, pull-request, manual"
            value={state.triggersOn}
            onValueChange={(v) => assetCreationStore.setTriggersOn(v)}
            testId="asset-wizard-triggers"
          />
        </Panel>
      ) : null}
    </div>
  );
}

// ── Step 4: Review & Create ──

function ReviewStep({ state }: { state: AssetCreationState }) {
  if (state.created) {
    return (
      <div className="asset-wizard-step" data-testid="asset-wizard-review-step">
        <Panel title="Asset Created" subtitle="Your asset has been created successfully." testId="asset-wizard-success-panel">
          <div className="asset-wizard-success" data-testid="asset-wizard-success">
            <p className="asset-wizard-success-icon">✓</p>
            <p className="asset-wizard-success-message">
              <strong>{state.title || state.assetKey}</strong> ({state.kind}) has been created in the <strong>{state.authoringScope}</strong> scope.
            </p>
            <Button
              onClick={() => {
                navigationStore.closeWizard();
                navigationStore.navigate('catalog');
                assetCreationStore.reset();
              }}
              testId="asset-wizard-view-catalog"
            >
              View in Catalog
            </Button>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="asset-wizard-step" data-testid="asset-wizard-review-step">
      <Panel title="Review" subtitle="Confirm the details before creating your asset." testId="asset-wizard-review-panel">
        <div className="asset-wizard-review-summary" data-testid="asset-wizard-review-summary">
          <div className="asset-wizard-review-row">
            <span className="asset-wizard-review-key">Kind</span>
            <span className="asset-wizard-review-value">{state.kind}</span>
          </div>
          <div className="asset-wizard-review-row">
            <span className="asset-wizard-review-key">Scope</span>
            <span className="asset-wizard-review-value">
              {state.authoringScope}
              {state.authoringScope === 'repo-local' && state.repoPath ? ` (${state.repoPath})` : ''}
            </span>
          </div>
          <div className="asset-wizard-review-row">
            <span className="asset-wizard-review-key">Asset key</span>
            <span className="asset-wizard-review-value">{state.assetKey || '(none)'}</span>
          </div>
          <div className="asset-wizard-review-row">
            <span className="asset-wizard-review-key">Title</span>
            <span className="asset-wizard-review-value">{state.title || '(none)'}</span>
          </div>
          <div className="asset-wizard-review-row">
            <span className="asset-wizard-review-key">Description</span>
            <span className="asset-wizard-review-value">{state.description || '(none)'}</span>
          </div>
          {state.kind === 'skill' ? (
            <>
              <div className="asset-wizard-review-row">
                <span className="asset-wizard-review-key">Load mode</span>
                <span className="asset-wizard-review-value">{state.loadMode}</span>
              </div>
              <div className="asset-wizard-review-row">
                <span className="asset-wizard-review-key">Triggers</span>
                <span className="asset-wizard-review-value">{state.triggersOn || '(none)'}</span>
              </div>
            </>
          ) : null}
          <div className="asset-wizard-review-row">
            <span className="asset-wizard-review-key">Content</span>
            <span className="asset-wizard-review-value">
              {state.content ? `${state.content.length} characters` : '(empty)'}
            </span>
          </div>
        </div>

        {state.content ? (
          <details className="asset-wizard-content-preview" data-testid="asset-wizard-content-preview">
            <summary>Preview content</summary>
            <pre className="code-block">{state.content}</pre>
          </details>
        ) : null}
      </Panel>

      {state.createError ? (
        <p className="asset-wizard-error" role="alert" data-testid="asset-wizard-create-error">
          {state.createError}
        </p>
      ) : null}

      {state.creating ? (
        <p className="asset-wizard-status" data-testid="asset-wizard-creating">
          Creating asset…
        </p>
      ) : null}
    </div>
  );
}

// ── Wizard steps definition ──

const WIZARD_STEPS = [
  { id: 'kind', label: 'Kind & Scope', description: 'Choose type and scope' },
  { id: 'identity', label: 'Identity', description: 'Name and describe' },
  { id: 'content', label: 'Content', description: 'Write instructions' },
  { id: 'review', label: 'Review', description: 'Confirm and create' },
];

function isStepValid(state: AssetCreationState, index: number): boolean {
  switch (index) {
    case 0:
      if (state.authoringScope === 'repo-local' && !state.repoPath.trim()) return false;
      return true;
    case 1:
      return state.assetKey.trim().length > 0 && !/\s/.test(state.assetKey);
    case 2:
      return state.content.trim().length > 0;
    case 3:
      return true;
    default:
      return true;
  }
}

// ── Main wizard component ──

export default function AssetCreationWizard() {
  const state = useStoreValue(assetCreationStore);

  const stepsWithValidity = WIZARD_STEPS.map((step, i) => ({
    ...step,
    isValid: isStepValid(state, i),
  }));

  function handleStepChange(index: number) {
    assetCreationStore.setStep(index);
  }

  async function handleComplete() {
    await assetCreationStore.create();
  }

  function handleCancel() {
    navigationStore.closeWizard();
    assetCreationStore.reset();
  }

  return (
    <div className="asset-creation-wizard" data-testid="asset-creation-wizard">
      <SteppedWizard
        steps={stepsWithValidity}
        activeStepIndex={state.step}
        onStepChange={handleStepChange}
        onComplete={handleComplete}
        onCancel={handleCancel}
        completeLabel={state.creating ? 'Creating…' : state.created ? 'Done' : 'Create Asset'}
        testId="asset-creation-wizard-stepped"
      >
        {state.step === 0 ? <KindStep state={state} /> : null}
        {state.step === 1 ? <IdentityStep state={state} /> : null}
        {state.step === 2 ? <ContentStep state={state} /> : null}
        {state.step === 3 ? <ReviewStep state={state} /> : null}
      </SteppedWizard>
    </div>
  );
}
