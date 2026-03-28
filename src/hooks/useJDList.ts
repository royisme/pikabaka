import { useMutation, useQuery, useQueryClient } from 'react-query';
import type { JDListItem } from '../../electron/knowledge/types';

export function useJDList(enabled = true) {
  return useQuery<JDListItem[]>(
    ['knowledge', 'jds'],
    () => window.electronAPI.knowledgeGetAllJDs(),
    { enabled, staleTime: 30_000 }
  );
}

export function useActivateJD() {
  const qc = useQueryClient();

  return useMutation(
    async (docId: number) => {
      const result = await window.electronAPI.knowledgeSetActiveJD(docId);
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to activate JD');
      }
      return result;
    },
    {
      onSuccess: () => {
        qc.invalidateQueries(['knowledge', 'jds']);
        qc.invalidateQueries(['profile', 'data']);
        qc.invalidateQueries(['profile', 'status']);
      },
    }
  );
}

export function useDeleteJD() {
  const qc = useQueryClient();

  return useMutation(
    async (docId: number) => {
      const result = await window.electronAPI.knowledgeDeleteJD(docId);
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to delete JD');
      }
      return result;
    },
    {
      onSuccess: () => {
        qc.invalidateQueries(['knowledge', 'jds']);
        qc.invalidateQueries(['profile', 'data']);
        qc.invalidateQueries(['profile', 'status']);
      },
    }
  );
}

export function useUploadNewJD() {
  const qc = useQueryClient();

  return useMutation(
    async (filePath: string) => {
      const result = await window.electronAPI.knowledgeUploadJD(filePath);
      if (!result?.success) {
        throw new Error(result?.error || 'JD upload failed');
      }
      return result;
    },
    {
      onSuccess: () => {
        qc.invalidateQueries(['knowledge', 'jds']);
        qc.invalidateQueries(['profile', 'data']);
        qc.invalidateQueries(['profile', 'status']);
      },
    }
  );
}
