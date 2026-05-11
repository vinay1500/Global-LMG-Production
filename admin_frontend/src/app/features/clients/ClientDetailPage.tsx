import React from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { WorkspaceState } from '../../components/shared/WorkspaceState';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { adminApi } from '../../lib/api/admin';
import { ClientDetailAdmin } from '../../modules/ClientDetailAdmin';
import { useAdminSession } from '../../providers/AdminSessionProvider';

export const ClientDetailPage = () => {
  const navigate = useNavigate();
  const { currentUser } = useAdminSession();
  const { clientId } = useParams();
  const permissionCodes = currentUser?.permissionCodes || [];
  const canCreateMatter = permissionCodes.includes('matter.update');
  const { data, errorMessage, isLoading, refresh } = useAsyncResource(
    () => adminApi.getClientWorkspace(String(clientId || '')),
    [clientId]
  );

  if (!clientId) {
    return <Navigate replace to="/clients" />;
  }

  if (isLoading && !data) {
    return (
      <WorkspaceState
        description="Fetching the client profile, matters, billing, documents, and communication history."
        title="Loading Client Workspace"
      />
    );
  }

  if (errorMessage && !data) {
    return (
      <WorkspaceState
        actionLabel="Try Again"
        description={errorMessage}
        onAction={() => void refresh().catch(() => undefined)}
        title="Client Workspace Unavailable"
      />
    );
  }

  if (!data) {
    return <Navigate replace to="/clients" />;
  }

  return (
    <ClientDetailAdmin
      auditEntries={data.auditEntries}
      client={data.client}
      documents={data.documents}
      events={data.events}
      invoices={data.invoices}
      matters={data.matters}
      notifications={data.notifications}
      onBack={() => navigate('/clients')}
      onCreateMatter={canCreateMatter ? () => navigate(`/matters?action=new&clientId=${data.client.id}`) : undefined}
      onViewMatter={(matter) => navigate(`/matters/${matter.id}`)}
      payments={data.payments}
      permissionCodes={permissionCodes}
      requests={data.requests}
      summary={data.summary}
      threads={data.threads}
    />
  );
};
