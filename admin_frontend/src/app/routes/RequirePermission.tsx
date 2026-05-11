import React from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAdminSession } from '../providers/AdminSessionProvider';

type RequirePermissionProps =
  | {
      anyOf?: never;
      permission: string;
    }
  | {
      anyOf: string[];
      permission?: never;
    };

export const RequirePermission: React.FC<RequirePermissionProps> = ({ anyOf, permission }) => {
  const location = useLocation();
  const { currentUser } = useAdminSession();
  const permissions = anyOf || (permission ? [permission] : []);
  const hasRequiredPermission = permissions.some((requiredPermission) =>
    currentUser?.permissionCodes.includes(requiredPermission)
  );

  if (!hasRequiredPermission) {
    return (
      <Navigate
        replace
        state={{ from: location.pathname, missingPermission: permission || permissions.join('|') }}
        to="/forbidden"
      />
    );
  }

  return <Outlet />;
};
