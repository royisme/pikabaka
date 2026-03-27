import { useMutation, useQueryClient } from 'react-query';
import { useProfileData } from './useProfileData';
import type { NegotiationScript } from '../../electron/knowledge/types';

export function useNegotiationScript() {
  const qc = useQueryClient();
  const { data: profileData } = useProfileData();

  const generateMutation = useMutation<{ success: boolean; script?: NegotiationScript; error?: string }, unknown, boolean | undefined>(
    async (force?: boolean) => {
      const result = await window.electronAPI.profileGenerateNegotiation(force);
      if (!result?.success) {
        throw new Error(result?.error || 'Negotiation script generation failed');
      }
      return result;
    },
    {
      onSuccess: () => {
        qc.invalidateQueries(['profile']);
        qc.invalidateQueries(['negotiation']);
      },
    }
  );

  return {
    generate: generateMutation.mutateAsync,
    script: profileData?.negotiationScript ?? null,
    isGenerating: generateMutation.isLoading,
    error: generateMutation.error as Error | null,
  };
}
