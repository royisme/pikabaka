import { useQuery } from 'react-query';

export function useProfileStatus() {
  return useQuery(['profile', 'status'], () => window.electronAPI.profileGetStatus(), {
    staleTime: 30_000,
  });
}
