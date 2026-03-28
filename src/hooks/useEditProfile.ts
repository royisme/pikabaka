import { useMutation, useQueryClient } from 'react-query';
import type { ProfileData } from '../../electron/knowledge/types';

export function useEditProfile() {
  const qc = useQueryClient();

  return useMutation(
    async (updates: Partial<ProfileData>) => {
      const result = await window.electronAPI.knowledgeUpdateProfile(updates);
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to update profile');
      }
      return result;
    },
    {
      onSuccess: () => {
        qc.invalidateQueries(['profile', 'data']);
        qc.invalidateQueries(['profile', 'status']);
      },
    }
  );
}
