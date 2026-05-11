import { forbidden } from '../../lib/httpErrors.js';
import type { AdminActor } from '../auth/service.js';

export const PROTECTED_ROLE_CODES = new Set([
  'bootstrap_admin',
  'ops_admin',
  'owner',
  'root',
  'super_admin',
  'system_admin',
]);

const PROTECTED_ROLE_ASSIGNER_CODES = new Set([
  'bootstrap_admin',
  'ops_admin',
  'owner',
  'root',
  'super_admin',
  'system_admin',
]);

const ASSIGNABLE_PROTECTED_ROLE_CODES = new Set(['ops_admin']);

const normalizeRoleCode = (roleCode: string) => roleCode.trim().toLowerCase();

export const isProtectedRoleCode = (roleCode: string) =>
  PROTECTED_ROLE_CODES.has(normalizeRoleCode(roleCode));

export const canAssignRoleCode = (actor: AdminActor, targetRoleCode: string) => {
  const normalizedTargetRoleCode = normalizeRoleCode(targetRoleCode);
  if (!PROTECTED_ROLE_CODES.has(normalizedTargetRoleCode)) {
    return true;
  }

  return (
    ASSIGNABLE_PROTECTED_ROLE_CODES.has(normalizedTargetRoleCode) &&
    actor.roleCodes.some((roleCode) => PROTECTED_ROLE_ASSIGNER_CODES.has(normalizeRoleCode(roleCode)))
  );
};

export const assertCanAssignRoleCode = (actor: AdminActor, targetRoleCode: string) => {
  if (!canAssignRoleCode(actor, targetRoleCode)) {
    throw forbidden(
      'protected_role_assignment_forbidden',
      'Protected roles can only be assigned by an approved protected administrator.'
    );
  }
};
