import { useQuery } from 'react-query';

interface ProfileStatus {
  hasProfile: boolean;
  profileMode: boolean;
  name?: string;
  role?: string;
  totalExperienceYears?: number;
}

export function useProfileStatus() {
  return useQuery<ProfileStatus>(['profile', 'status'], () => window.electronAPI.profileGetStatus(), {
    staleTime: 30_000,
  });
}
