import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { PaginationControls } from '../../components/shared/PaginationControls';
import { WorkspaceState } from '../../components/shared/WorkspaceState';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { adminApi } from '../../lib/api/admin';
import { ClientDirectory } from '../../modules/ClientDirectory';
import { useAdminSession } from '../../providers/AdminSessionProvider';

export const ClientsPage = () => {
  const navigate = useNavigate();
  const { currentUser } = useAdminSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const permissionCodes = currentUser?.permissionCodes || [];
  const canCreateClient = permissionCodes.includes('client_account.manage');
  const assignedClientScope =
    permissionCodes.includes('client_account.view_assigned') && !permissionCodes.includes('client_account.view');
  const { data, errorMessage, isLoading, refresh } = useAsyncResource(
    () => adminApi.listClients({ limit, offset }),
    [limit, offset]
  );

  if (isLoading && !data) {
    return (
      <WorkspaceState
        description="Loading client accounts and recent activity."
        title="Loading Client Directory"
      />
    );
  }

  if (errorMessage && !data) {
    return (
      <WorkspaceState
        actionLabel="Try Again"
        description={errorMessage}
        onAction={() => void refresh().catch(() => undefined)}
        title="Client Directory Unavailable"
      />
    );
  }

  return (
    <>
      <ClientDirectory
        assignedScope={assignedClientScope}
        clients={data?.clients}
        createRequested={canCreateClient && searchParams.get('action') === 'new'}
        onCreateClient={
          canCreateClient
            ? async (payload) => {
                const response = await adminApi.createClient(payload);
                setOffset(0);
                await refresh().catch(() => undefined);
                navigate(`/clients/${response.client.id}`);
                return response;
              }
            : undefined
        }
        onCreateRequestHandled={() => setSearchParams({})}
        onSelectClient={(client) => navigate(`/clients/${client.id}`)}
      />
      <PaginationControls
        isLoading={isLoading}
        onOffsetChange={setOffset}
        pagination={data?.pagination}
      />
    </>
  );
};
