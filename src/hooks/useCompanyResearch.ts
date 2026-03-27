import { useMutation, useQueryClient } from 'react-query';
import type { CompanyDossier } from '../../electron/knowledge/types';

export function useCompanyResearch() {
  const qc = useQueryClient();

  return useMutation<{ success: boolean; dossier?: CompanyDossier; error?: string }, unknown, string>(
    async (companyName: string) => {
      const result = await window.electronAPI.profileResearchCompany(companyName);
      if (!result?.success) {
        throw new Error(result?.error || 'Company research failed');
      }
      return result;
    },
    {
      onSuccess: () => {
        qc.invalidateQueries(['profile', 'data']);
      },
    }
  );
}
