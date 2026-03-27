import { useMutation, useQueryClient } from 'react-query';
import { useProfileStatus } from './useProfileStatus';

export function useKnowledgeMode() {
  const { data: status } = useProfileStatus();
  const qc = useQueryClient();

  const toggle = useMutation(
    async (enabled: boolean) => {
      const result = await window.electronAPI.profileSetMode(enabled);
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to update knowledge mode');
      }
      return result;
    },
    {
      onSuccess: () => {
        qc.invalidateQueries(['profile', 'status']);
      },
    }
  );

  return {
    isEnabled: status?.profileMode ?? false,
    hasProfile: status?.hasProfile ?? false,
    toggle,
  };
}
