import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import type {
  MatterPackageProposalsResponse,
  MatterWorkspaceResponse,
} from '../../lib/api/contracts';
import { WorkspaceState } from '../../components/shared/WorkspaceState';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { adminApi } from '../../lib/api/admin';
import { MatterDetailAdmin } from '../../modules/MatterDetailAdmin';
import type { PackageTier } from '../../modules/PackageBuilder';
import { useAdminSession } from '../../providers/AdminSessionProvider';

const toDraftPayload = (packages: PackageTier[]) => ({
  packages: packages.map((pkg, index) => ({
    description: pkg.description,
    displayOrder: index,
    featurePoints: pkg.points,
    id: pkg.id.startsWith('tier-') ? undefined : pkg.id,
    isRecommended: pkg.isRecommended,
    name: pkg.name,
    price: pkg.price,
  })),
});

export const MatterDetailPage = () => {
  const navigate = useNavigate();
  const { matterId } = useParams();
  const { currentUser } = useAdminSession();
  const permissionCodes = currentUser?.permissionCodes || [];
  const canManageMatter = permissionCodes.includes('matter.update');
  const canManageDocuments = permissionCodes.includes('document.manage');
  const canManageEvents = permissionCodes.includes('event.manage');
  const { data, errorMessage, isLoading, refresh } = useAsyncResource(
    () => adminApi.getMatterWorkspace(String(matterId || '')),
    [matterId]
  );
  const [workspace, setWorkspace] = useState<MatterWorkspaceResponse | null>(null);
  const {
    data: packageWorkspaceData,
    errorMessage: packageErrorMessage,
    isLoading: isPackageLoading,
    refresh: refreshPackageWorkspace,
    setData: setPackageWorkspace,
  } = useAsyncResource(
    () =>
      canManageMatter
        ? adminApi.getMatterPackageProposals(String(matterId || ''))
        : Promise.resolve(null),
    [canManageMatter, matterId]
  );
  const [packageWorkspaceState, setPackageWorkspaceState] =
    useState<MatterPackageProposalsResponse | null>(null);

  useEffect(() => {
    if (data) {
      setWorkspace(data);
    }
  }, [data]);

  useEffect(() => {
    if (packageWorkspaceData) {
      setPackageWorkspaceState(packageWorkspaceData);
    }
  }, [packageWorkspaceData]);

  const workspaceSnapshot = workspace ?? data;
  const packageWorkspaceSnapshot = packageWorkspaceState ?? packageWorkspaceData;

  const matter = useMemo(() => workspaceSnapshot?.matter ?? null, [workspaceSnapshot]);
  const packageWorkspace = useMemo(
    () => packageWorkspaceSnapshot?.matter?.id === matterId ? packageWorkspaceSnapshot : null,
    [matterId, packageWorkspaceSnapshot]
  );

  if (!matterId) {
    return <Navigate replace to="/matters" />;
  }

  if (isLoading && !workspaceSnapshot) {
    return (
      <WorkspaceState
        description="Fetching the matter record, linked documents, events, invoices, and message threads."
        title="Loading Matter Workspace"
      />
    );
  }

  if (errorMessage && !workspaceSnapshot) {
    return (
      <WorkspaceState
        actionLabel="Try Again"
        description={errorMessage}
        onAction={() => void refresh().catch(() => undefined)}
        title="Matter Workspace Unavailable"
      />
    );
  }

  if (!matter) {
    return <Navigate replace to="/matters" />;
  }

  const handleUpdateFee = async (_targetMatterId: string, newFee: number) => {
    await adminApi.updateMatterDetails(String(matterId || ''), {
      quotedTotalAmount: newFee,
    });
    const nextWorkspace = await refresh();
    setWorkspace(nextWorkspace);
  };

  const refreshAll = async () => {
    const [nextWorkspace, nextPackageWorkspace] = await Promise.all([
      refresh(),
      refreshPackageWorkspace(),
    ]);
    setWorkspace(nextWorkspace);
    setPackageWorkspace(nextPackageWorkspace);
    setPackageWorkspaceState(nextPackageWorkspace);
    return {
      nextPackageWorkspace,
      nextWorkspace,
    };
  };

  return (
      <MatterDetailAdmin
      assignmentOptions={canManageMatter ? workspaceSnapshot?.assignmentOptions : undefined}
      buildDocumentDownloadUrl={adminApi.buildDocumentDownloadUrl}
      buildDocumentPreviewUrl={adminApi.buildDocumentPreviewUrl}
      isPackageLoading={isPackageLoading}
      matter={matter}
      myDocs={workspaceSnapshot?.documents || []}
      myEvents={workspaceSnapshot?.events || []}
      myInvoices={workspaceSnapshot?.invoices || []}
      myThreads={workspaceSnapshot?.threads || []}
      packageErrorMessage={packageErrorMessage}
      packageWorkspace={packageWorkspace}
      serviceOptions={workspaceSnapshot?.createOptions?.services}
      onAddMatterNote={canManageMatter ? async (payload) => {
        await adminApi.createMatterNote(matter.id, payload);
        const nextWorkspace = await refresh();
        setWorkspace(nextWorkspace);
      } : undefined}
      onAssignMatter={canManageMatter ? async (payload) => {
        await adminApi.createMatterAssignment(matter.id, payload);
        const nextWorkspace = await refresh();
        setWorkspace(nextWorkspace);
      } : undefined}
      onReplaceMatterAssignments={canManageMatter ? async (payload) => {
        await adminApi.replaceMatterAssignments(matter.id, payload);
        const nextWorkspace = await refresh();
        setWorkspace(nextWorkspace);
      } : undefined}
      onBack={() => navigate('/matters')}
      onChat={() => navigate('/messages')}
      onCreateEvent={canManageEvents ? async (payload) => {
        await adminApi.createEvent({
          ...payload,
          clientAccountId: matter.clientId,
          matterId: matter.id,
        });
        const nextWorkspace = await refresh();
        setWorkspace(nextWorkspace);
      } : undefined}
      onArchiveProposal={canManageMatter ? async (proposalVersion) => {
        const nextPackageWorkspace = await adminApi.archiveMatterProposal(matter.id, proposalVersion);
        setPackageWorkspace(nextPackageWorkspace);
        setPackageWorkspaceState(nextPackageWorkspace);
      } : undefined}
      onOverridePackageSelection={canManageMatter ? async (matterPackageId, reasonText) => {
        await adminApi.overrideMatterPackageSelection(matter.id, {
          matterPackageId,
          reasonText,
        });
        await refreshAll();
      } : undefined}
      onPublishProposal={canManageMatter ? async (proposalVersion) => {
        await adminApi.publishMatterProposal(matter.id, {
          proposalVersion,
        });
        await refreshAll();
      } : undefined}
      onSaveMatterDetails={canManageMatter ? async (payload) => {
        await adminApi.updateMatterDetails(matter.id, payload);
        const nextWorkspace = await refresh();
        setWorkspace(nextWorkspace);
      } : undefined}
      onSavePackageDraft={canManageMatter ? async (packages) => {
        const nextPackageWorkspace = await adminApi.saveMatterPackageDraft(matter.id, {
          ...toDraftPayload(packages),
          proposalVersion: packageWorkspace?.draft?.proposalVersion,
        });
        setPackageWorkspace(nextPackageWorkspace);
        setPackageWorkspaceState(nextPackageWorkspace);
      } : undefined}
      onUpdateFee={canManageMatter ? handleUpdateFee : undefined}
      onUpdateDocumentControls={canManageDocuments ? async (documentId, payload) => {
        await adminApi.updateDocumentControls(documentId, payload);
        const nextWorkspace = await refresh();
        setWorkspace(nextWorkspace);
      } : undefined}
      onUpdateStage={async (payload) => {
        await adminApi.updateMatterStage(matter.id, payload);
        const nextWorkspace = await refresh();
        setWorkspace(nextWorkspace);
      }}
      onUploadDocument={canManageDocuments ? async (payload) => {
        await adminApi.uploadDocument({
          ...payload,
          matterId: matter.id,
        });
        const nextWorkspace = await refresh();
        setWorkspace(nextWorkspace);
      } : undefined}
    />
  );
};
