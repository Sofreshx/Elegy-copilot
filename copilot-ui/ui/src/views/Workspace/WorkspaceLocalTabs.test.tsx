import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WorkspaceLocalTabs from './WorkspaceLocalTabs';

describe('WorkspaceLocalTabs', () => {
  it('renders all four tabs', () => {
    const onTabChange = vi.fn();
    render(<WorkspaceLocalTabs activeTab="docs" onTabChange={onTabChange} />);
    expect(screen.getByTestId('workspace-local-tab-docs')).toBeDefined();
    expect(screen.getByTestId('workspace-local-tab-git')).toBeDefined();
    expect(screen.getByTestId('workspace-local-tab-planning')).toBeDefined();
    expect(screen.getByTestId('workspace-local-tab-execution')).toBeDefined();
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

  it('does not show Workspace heading', () => {
    const onTabChange = vi.fn();
    const { container } = render(<WorkspaceLocalTabs activeTab="docs" onTabChange={onTabChange} />);
    expect(container.textContent).not.toContain('Workspace');
  });
});
