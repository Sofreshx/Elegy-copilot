/**
 * React Query hooks for app settings.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { settingsDb, AppSettings, AVAILABLE_SKILLS } from '../services/settingsDb';

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsDb.getSettings(),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useAvailableSkills() {
  return useQuery({
    queryKey: ['available-skills'],
    queryFn: () => Promise.resolve(AVAILABLE_SKILLS),
    staleTime: Infinity, // Static data
  });
}

export function useSetDefaultAgent() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (agentId: string) => settingsDb.setDefaultAgent(agentId),
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings'], updated);
    },
  });
}

export function useSetSkillEnabled() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ skillId, enabled }: { skillId: string; enabled: boolean }) =>
      settingsDb.setSkillEnabled(skillId, enabled),
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings'], updated);
    },
  });
}

export function useSetNotification() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({
      key,
      enabled,
    }: {
      key: keyof AppSettings['notifications'];
      enabled: boolean;
    }) => settingsDb.setNotificationSetting(key, enabled),
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings'], updated);
    },
  });
}

export function useSaveSettings() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (settings: Partial<AppSettings>) => settingsDb.saveSettings(settings),
    onSuccess: (updated) => {
      queryClient.setQueryData(['settings'], updated);
    },
  });
}
