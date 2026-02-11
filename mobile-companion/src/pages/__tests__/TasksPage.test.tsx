import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import TasksPage from '../TasksPage';

// Mock apiClient
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();

vi.mock('../../services/apiClient', () => ({
  getApiClient: () => ({
    get: mockGet,
    post: mockPost,
    put: mockPut,
    delete: mockDelete,
  }),
}));

// Suppress window.confirm in tests
vi.stubGlobal('confirm', () => true);

const SAMPLE_TASKS = {
  tasks: [
    {
      id: 1,
      user_id: 'u1',
      title: 'Fix bug',
      description: 'Fix the login bug',
      priority: 2,
      status: 'pending',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 2,
      user_id: 'u1',
      title: 'Add tests',
      description: null,
      priority: 1,
      status: 'in-progress',
      created_at: '2026-01-02T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/tasks']}>
      <TasksPage />
    </MemoryRouter>
  );
}

describe('TasksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(SAMPLE_TASKS);
  });

  it('shows loading state initially', () => {
    // Never resolve so we stay in loading
    mockGet.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText('Loading tasks...')).toBeInTheDocument();
  });

  it('displays tasks after fetch', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Fix bug')).toBeInTheDocument();
    });

    expect(screen.getByText('Add tests')).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith('/api/tasks');
  });

  it('shows error state on fetch failure', async () => {
    mockGet.mockRejectedValue(new Error('Network error'));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('shows empty state when no tasks', async () => {
    mockGet.mockResolvedValue({ tasks: [], total: 0, page: 1, limit: 20 });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No tasks found')).toBeInTheDocument();
    });
  });

  it('filter buttons change the fetch URL', async () => {
    const user = userEvent.setup();
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Fix bug')).toBeInTheDocument();
    });

    // Click "Pending" filter
    await user.click(screen.getByText('Pending'));

    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/api/tasks?status=pending');
    });
  });

  it('create form submits correctly', async () => {
    const user = userEvent.setup();
    mockPost.mockResolvedValue({});
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Fix bug')).toBeInTheDocument();
    });

    // Open create form
    await user.click(screen.getByText('+ New Task'));

    // Fill in title
    const titleInput = screen.getByPlaceholderText('Task title');
    await user.type(titleInput, 'New task title');

    // Submit
    await user.click(screen.getByText('Create Task'));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/api/tasks', {
        title: 'New task title',
        description: null,
        priority: 1,
      });
    });
  });

  it('renders status action buttons for tasks', async () => {
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Fix bug')).toBeInTheDocument();
    });

    // Pending task should have "Start" button
    expect(screen.getByText('Start')).toBeInTheDocument();
    // In-progress task should have "Complete" button
    expect(screen.getByText('Complete')).toBeInTheDocument();
    // Both should have "Delete" buttons
    expect(screen.getAllByText('Delete')).toHaveLength(2);
  });

  it('updates task status when action button clicked', async () => {
    const user = userEvent.setup();
    mockPut.mockResolvedValue({});
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Start')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Start'));

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalledWith('/api/tasks/1', { status: 'in-progress' });
    });
  });

  it('deletes task when delete button clicked', async () => {
    const user = userEvent.setup();
    mockDelete.mockResolvedValue(undefined);
    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Fix bug')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByText('Delete');
    const firstDelete = deleteButtons[0];
    if (!firstDelete) throw new Error('Delete button not found');
    await user.click(firstDelete);

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/api/tasks/1');
    });
  });
});
