import { UserRole, FeatureKey } from '@/types';
import { ROLE_PERMISSIONS } from '@/constants/roles';

/**
 * Check if a role can access a feature.
 */
export function canAccess(role: UserRole | undefined, feature: FeatureKey): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role][feature] ?? false;
}
