import { useQuery } from 'react-query';
import type { ProfileData } from '../../electron/knowledge/types';

export function useProfileData(enabled = true) {
  return useQuery<ProfileData | null>(['profile', 'data'], () => window.electronAPI.profileGetProfile(), {
    enabled,
    staleTime: 60_000,
  });
}
