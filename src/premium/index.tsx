/**
 * Premium Module Loader
 *
 * Uses Vite's import.meta.glob to optionally load premium components
 * from the premium/ directory. If the premium/ folder is removed
 * (open-source build), the globs return empty objects and no-op
 * fallbacks are used instead. No build errors.
 */
import React from 'react';

// ─── No-op fallbacks ────────────────────────────────────────────────
const NullComponent: React.FC<any> = () => null;

const nullAdCampaigns = (
  _isPremium: boolean,
  _hasProfile: boolean,
  _isAppReady: boolean,
  _appStartTime?: number,
  _lastMeetingEndTime?: number | null,
  _isProcessingMeeting?: boolean
) => ({
  activeAd: null as string | null,
  dismissAd: () => {},
});

// ─── Glob-import premium modules (empty {} when premium/ is absent) ──
const _premiumModal = import.meta.glob<any>(
  '../../premium/src/PremiumUpgradeModal.tsx',
  { eager: true }
);
// ProfileVisualizer — direct import from local components
import { ProfileVisualizer as _ProfileVisualizerLocal } from '../components/knowledge/ProfileVisualizer';
const _promoToaster = import.meta.glob<any>(
  '../../premium/src/PremiumPromoToaster.tsx',
  { eager: true }
);
const _profileToaster = import.meta.glob<any>(
  '../../premium/src/ProfileFeatureToaster.tsx',
  { eager: true }
);
const _jdToaster = import.meta.glob<any>(
  '../../premium/src/JDAwarenessToaster.tsx',
  { eager: true }
);
const _remoteCampaignToaster = import.meta.glob<any>(
  '../../premium/src/RemoteCampaignToaster.tsx',
  { eager: true }
);
const _adHook = import.meta.glob<any>(
  '../../premium/src/useAdCampaigns.ts',
  { eager: true }
);
// NegotiationCoachingCard — direct import from local components
import { NegotiationCoachingCard as _NegotiationCoachingCardLocal } from '../components/knowledge/NegotiationCoachingCard';

// ─── Helper ──────────────────────────────────────────────────────────
function get<T>(mods: Record<string, any>, name: string, fallback: T): T {
  const mod = Object.values(mods)[0];
  return mod?.[name] ?? fallback;
}

// ─── Exports (always safe to import) ─────────────────────────────────
export const PremiumUpgradeModal: React.FC<any> =
  get(_premiumModal, 'PremiumUpgradeModal', NullComponent);

export const ProfileVisualizer: React.FC<any> = _ProfileVisualizerLocal;

export const PremiumPromoToaster: React.FC<any> =
  get(_promoToaster, 'PremiumPromoToaster', NullComponent);

export const ProfileFeatureToaster: React.FC<any> =
  get(_profileToaster, 'ProfileFeatureToaster', NullComponent);

export const JDAwarenessToaster: React.FC<any> =
  get(_jdToaster, 'JDAwarenessToaster', NullComponent);

export const RemoteCampaignToaster: React.FC<any> =
  get(_remoteCampaignToaster, 'RemoteCampaignToaster', NullComponent);

export const useAdCampaigns: typeof nullAdCampaigns =
  get(_adHook, 'useAdCampaigns', nullAdCampaigns);

export const NegotiationCoachingCard: React.FC<any> = _NegotiationCoachingCardLocal;
