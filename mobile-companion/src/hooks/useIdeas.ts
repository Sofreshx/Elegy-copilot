/**
 * React Query hooks for idea management.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ideasDb, Idea, IdeaInput, IdeaFilters } from '../services/ideasDb';

export { type IdeaFilters };

export function useIdeas(filters?: IdeaFilters) {
  return useQuery({
    queryKey: ['ideas', filters],
    queryFn: async () => {
      let ideas = await ideasDb.getAll();
      
      if (filters?.status) {
        ideas = ideas.filter((i) => i.status === filters.status);
      }
      if (filters?.priority) {
        ideas = ideas.filter((i) => i.priority === filters.priority);
      }
      
      // Sort by updatedAt descending
      return ideas.sort((a, b) => b.updatedAt - a.updatedAt);
    },
  });
}

export function useIdea(id: string | null) {
  return useQuery({
    queryKey: ['idea', id],
    queryFn: () => (id ? ideasDb.getById(id) : null),
    enabled: !!id,
  });
}

export function useTags() {
  return useQuery({
    queryKey: ['idea-tags'],
    queryFn: () => ideasDb.getAllTags(),
  });
}

export function useCreateIdea() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (input: IdeaInput) => ideasDb.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ideas'] });
      queryClient.invalidateQueries({ queryKey: ['idea-tags'] });
    },
  });
}

export function useUpdateIdea() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: Partial<IdeaInput> }) =>
      ideasDb.update(id, changes),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['ideas'] });
      queryClient.invalidateQueries({ queryKey: ['idea', updated.id] });
      queryClient.invalidateQueries({ queryKey: ['idea-tags'] });
    },
  });
}

export function useDeleteIdea() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => ideasDb.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ideas'] });
      queryClient.invalidateQueries({ queryKey: ['idea-tags'] });
    },
  });
}

export function useExportIdea() {
  return useMutation({
    mutationFn: async (id: string) => {
      const idea = await ideasDb.getById(id);
      if (!idea) return null;
      return ideasDb.exportToMarkdown(idea);
    },
  });
}

export function exportIdeaAsMarkdown(idea: Idea): string {
  return ideasDb.exportToMarkdown(idea);
}
