import { useMutation } from 'react-query';
import type { InterviewPrepData } from '../../electron/knowledge/types';

export function useGeneratePrep() {
  return useMutation(async (jdId?: number) => {
    const result = await window.electronAPI.knowledgeGeneratePrep(jdId);
    if (!result?.success) throw new Error(result?.error || 'Failed to generate prep');
    return result.data as InterviewPrepData;
  });
}
