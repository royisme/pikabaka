import { useMutation, useQueryClient } from 'react-query';

export function useUploadJD() {
  const qc = useQueryClient();

  return useMutation(
    async (filePath: string) => {
      const result = await window.electronAPI.profileUploadJD(filePath);
      if (!result?.success) {
        throw new Error(result?.error || 'JD upload failed');
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
