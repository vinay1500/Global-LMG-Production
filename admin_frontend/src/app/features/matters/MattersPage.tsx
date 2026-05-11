import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { PlatformUser } from '../../data/adminTypes';
import { PaginationControls } from '../../components/shared/PaginationControls';
import { WorkspaceState } from '../../components/shared/WorkspaceState';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { adminApi } from '../../lib/api/admin';
import { MatterDeskAdmin } from '../../modules/MatterDeskAdmin';
import { useAdminSession } from '../../providers/AdminSessionProvider';

export const MattersPage = () => {
  const navigate = useNavigate();
  const { currentUser } = useAdminSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const permissionCodes = currentUser?.permissionCodes || [];
  const canCreateMatter = permissionCodes.includes('matter.update');
  const assignedMatterScope =
    permissionCodes.includes('matter.view_assigned') && !permissionCodes.includes('matter.view');
  const { data, errorMessage, isLoading, refresh } = useAsyncResource(
    () => adminApi.listMatters({ limit, offset }),
    [limit, offset]
  );
  const clients = useMemo<PlatformUser[]>(
    () => {
      if (data?.createOptions?.clients?.length) {
        return data.createOptions.clients.map((client) => ({
          avatar: '',
          email: client.email,
          id: client.id,
          joinedAt: '',
          lastActiveAt: '',
          lifecycle: 'client' as const,
          name: client.name,
          owner: '',
          phone: '',
          region: '',
        }));
      }

      return Array.from(
        new Map(
          (data?.matters || []).map((matter) => [
            matter.clientId,
            {
              avatar: '',
              email: '',
              id: matter.clientId,
              joinedAt: matter.createdAt,
              lastActiveAt: matter.lastUpdated,
              lifecycle: 'client' as const,
              name: matter.clientName,
              owner: matter.assignedStaff || '',
              phone: '',
              region: '',
            },
          ])
        ).values()
      );
    },
    [data]
  );

  if (isLoading && !data) {
    return (
      <WorkspaceState
        description="Loading active matters and assignment details."
        title="Loading Matter Desk"
      />
    );
  }

  if (errorMessage && !data) {
    return (
      <WorkspaceState
        actionLabel="Try Again"
        description={errorMessage}
        onAction={() => void refresh().catch(() => undefined)}
        title="Matter Desk Unavailable"
      />
    );
  }

  return (
    <>
      <MatterDeskAdmin
        assignedScope={assignedMatterScope}
        clients={clients}
        createOptions={data?.createOptions}
        createRequested={canCreateMatter && searchParams.get('action') === 'new'}
        matters={data?.matters || []}
        onCreateMatter={
          canCreateMatter
            ? async (payload) => {
                const response = await adminApi.createMatter(payload);
                setOffset(0);
                await refresh().catch(() => undefined);
                navigate(`/matters/${response.matter.id}`);
                return response;
              }
            : undefined
        }
        onCreateRequestHandled={() => setSearchParams({})}
        onViewMatter={(matter) => navigate(`/matters/${matter.id}`)}
        preselectedClientId={searchParams.get('clientId') || undefined}
      />
      <PaginationControls
        isLoading={isLoading}
        onOffsetChange={setOffset}
        pagination={data?.pagination}
      />
    </>
  );
};
