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
    expect(planningTab).toHaveAttribute('title', 'Planning');
    expect(executionTab).toHaveAttribute('title', 'Execution');
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

  it('does not show Workspace heading or text labels', () => {
    const onTabChange = vi.fn();
    const { container } = render(<WorkspaceLocalTabs activeTab="docs" onTabChange={onTabChange} />);
    expect(container.textContent).not.toContain('Workspace');
    expect(container.textContent).not.toContain('Docs');
    expect(container.textContent).not.toContain('Git');
    expect(container.textContent).not.toContain('Planning');
    expect(container.textContent).not.toContain('Execution');
  });

  it('renders icon-only tabs with accessible labels', () => {
    const onTabChange = vi.fn();
    render(<WorkspaceLocalTabs activeTab="docs" onTabChange={onTabChange} />);
    const docsTab = screen.getByTestId('workspace-local-tab-docs');
    const gitTab = screen.getByTestId('workspace-local-tab-git');
    const planningTab = screen.getByTestId('workspace-local-tab-planning');
    const executionTab = screen.getByTestId('workspace-local-tab-execution');

    // Each button has aria-label matching the tab label
    expect(docsTab).toHaveAttribute('aria-label', 'Docs');
    expect(gitTab).toHaveAttribute('aria-label', 'Git');
    expect(planningTab).toHaveAttribute('aria-label', 'Planning');
    expect(executionTab).toHaveAttribute('aria-label', 'Execution');

    // Each button has title matching the aria-label
    expect(docsTab).toHaveAttribute('title', 'Docs');
    expect(gitTab).toHaveAttribute('title', 'Git');
    expect(planningTab).toHaveAttribute('title', 'Planning');
    expect(executionTab).toHaveAttribute('title', 'Execution');

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
