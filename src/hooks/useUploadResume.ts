import { useMutation, useQueryClient } from 'react-query';

export function useUploadResume() {
  const qc = useQueryClient();

  return useMutation(
    async (filePath: string) => {
      const result = await window.electronAPI.profileUploadResume(filePath);
      if (!result?.success) {
        throw new Error(result?.error || 'Resume upload failed');
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
