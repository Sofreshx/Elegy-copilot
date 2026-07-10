import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WorkspaceLocalTabs from './WorkspaceLocalTabs';

describe('WorkspaceLocalTabs', () => {
  it('renders all tabs with title attributes', () => {
    const onTabChange = vi.fn();
    render(<WorkspaceLocalTabs activeTab="docs" onTabChange={onTabChange} />);
    const docsTab = screen.getByTestId('workspace-local-tab-docs');
    const gitTab = screen.getByTestId('workspace-local-tab-git');
    const planningTab = screen.getByTestId('workspace-local-tab-planning');
    const executionTab = screen.getByTestId('workspace-local-tab-execution');
    expect(screen.queryByTestId('workspace-local-tab-notes')).toBeNull();
    expect(docsTab).toBeDefined();
    expect(gitTab).toBeDefined();
    expect(planningTab).toBeDefined();
    expect(executionTab).toBeDefined();
    expect(docsTab).toHaveAttribute('title', 'Docs');
    expect(gitTab).toHaveAttribute('title', 'Git');
    expect(planningTab).toHaveAttribute('title', 'Plan');
    expect(executionTab).toHaveAttribute('title', 'Execute');
  });

  it('highlights the active tab', () => {
    const onTabChange = vi.fn();
    render(<WorkspaceLocalTabs activeTab="git" onTabChange={onTabChange} />);
    const gitTab = screen.getByTestId('workspace-local-tab-git');
    expect(gitTab.className).toContain('workspace-local-tab-active');
    expect(gitTab.getAttribute('aria-selected')).toBe('true');
  });

  it('calls onTabChange when clicking a tab', () => {
    const onTabChange = vi.fn();
    render(<WorkspaceLocalTabs activeTab="docs" onTabChange={onTabChange} />);
    fireEvent.click(screen.getByTestId('workspace-local-tab-git'));
    expect(onTabChange).toHaveBeenCalledWith('git');
  });

  it('implements roving keyboard navigation with wraparound and Home/End', () => {
    const onTabChange = vi.fn();
    render(<WorkspaceLocalTabs activeTab="docs" onTabChange={onTabChange} />);
    const docsTab = screen.getByTestId('workspace-local-tab-docs');

    expect(docsTab).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('workspace-local-tab-planning')).toHaveAttribute('tabindex', '-1');

    docsTab.focus();
    fireEvent.keyDown(docsTab, { key: 'ArrowRight' });
    expect(onTabChange).toHaveBeenLastCalledWith('planning');
    expect(screen.getByTestId('workspace-local-tab-planning')).toHaveFocus();

    fireEvent.keyDown(screen.getByTestId('workspace-local-tab-planning'), { key: 'End' });
    expect(onTabChange).toHaveBeenLastCalledWith('health');
    expect(screen.getByTestId('workspace-local-tab-health')).toHaveFocus();

    fireEvent.keyDown(screen.getByTestId('workspace-local-tab-health'), { key: 'Home' });
    expect(onTabChange).toHaveBeenLastCalledWith('docs');
    expect(docsTab).toHaveFocus();

    fireEvent.keyDown(docsTab, { key: 'ArrowLeft' });
    expect(onTabChange).toHaveBeenLastCalledWith('health');
  });

  it('links every stable tab id to its panel id', () => {
    render(<WorkspaceLocalTabs activeTab="docs" onTabChange={() => {}} />);
    const docsTab = screen.getByTestId('workspace-local-tab-docs');
    expect(docsTab).toHaveAttribute('id', 'workspace-tab-docs');
    expect(docsTab).toHaveAttribute('aria-controls', 'workspace-panel-docs');
  });

  it('shows the approved labels in the approved order', () => {
    const onTabChange = vi.fn();
    const { container } = render(<WorkspaceLocalTabs activeTab="docs" onTabChange={onTabChange} />);
    expect(container.textContent).toBe('DocsPlanExecuteGitChecksAssetsHealth');
  });

  it('renders labeled tabs with accessible labels', () => {
    const onTabChange = vi.fn();
    render(<WorkspaceLocalTabs activeTab="docs" onTabChange={onTabChange} />);
    const docsTab = screen.getByTestId('workspace-local-tab-docs');
    const gitTab = screen.getByTestId('workspace-local-tab-git');
    const planningTab = screen.getByTestId('workspace-local-tab-planning');
    const executionTab = screen.getByTestId('workspace-local-tab-execution');

    // Each button has aria-label matching the tab label
    expect(docsTab).toHaveAttribute('aria-label', 'Docs');
    expect(gitTab).toHaveAttribute('aria-label', 'Git');
    expect(planningTab).toHaveAttribute('aria-label', 'Plan');
    expect(executionTab).toHaveAttribute('aria-label', 'Execute');

    // Each button has title matching the aria-label
    expect(docsTab).toHaveAttribute('title', 'Docs');
    expect(gitTab).toHaveAttribute('title', 'Git');
    expect(planningTab).toHaveAttribute('title', 'Plan');
    expect(executionTab).toHaveAttribute('title', 'Execute');

    expect(docsTab).toHaveTextContent('Docs');
    expect(planningTab).toHaveTextContent('Plan');
    expect(executionTab).toHaveTextContent('Execute');

    // Each button has role="tab"
    expect(docsTab).toHaveAttribute('role', 'tab');
    expect(gitTab).toHaveAttribute('role', 'tab');
    expect(planningTab).toHaveAttribute('role', 'tab');
    expect(executionTab).toHaveAttribute('role', 'tab');

    // Active tab has aria-selected=true, others false
    expect(docsTab).toHaveAttribute('aria-selected', 'true');
    expect(gitTab).toHaveAttribute('aria-selected', 'false');
    expect(planningTab).toHaveAttribute('aria-selected', 'false');
    expect(executionTab).toHaveAttribute('aria-selected', 'false');
  });
});
