import React from 'react';
import { WorkspaceState } from '../../components/shared/WorkspaceState';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { adminApi } from '../../lib/api/admin';
import { SettingsWorkspace } from '../../modules/SettingsWorkspace';

export const SettingsPage = () => {
  const { data, errorMessage, isLoading, refresh } = useAsyncResource(
    () => adminApi.getSettingsWorkspace(),
    []
  );

  if (isLoading && !data) {
    return (
      <WorkspaceState
        description="Loading shared platform configuration, pricing rules, invoice settings, notification types, and governed RBAC metadata."
        title="Loading Settings"
      />
    );
  }

  if (errorMessage && !data) {
    return (
      <WorkspaceState
        actionLabel="Try Again"
        description={errorMessage}
        onAction={() => void refresh().catch(() => undefined)}
        title="Settings Unavailable"
      />
    );
  }

  if (!data) {
    return null;
  }

  return (
    <SettingsWorkspace
      onArchivePricingSlab={async (slabId) => {
        await adminApi.archivePricingSlab(slabId);
        await refresh();
      }}
      onArchiveConsultationMode={async (modeCode) => {
        await adminApi.archiveConsultationMode(modeCode);
        await refresh();
      }}
      onArchiveCountryPricing={async (countryPricingId) => {
        await adminApi.archiveCountryPricing(countryPricingId);
        await refresh();
      }}
      onArchivePriceOverride={async (overrideId) => {
        await adminApi.archivePriceOverride(overrideId);
        await refresh();
      }}
      onArchiveService={async (serviceId) => {
        await adminApi.archiveServiceCatalogService(serviceId);
        await refresh();
      }}
      onArchiveServiceDomain={async (domainCode) => {
        await adminApi.archiveServiceCatalogDomain(domainCode);
        await refresh();
      }}
      onArchiveUrgencyRule={async (ruleId) => {
        await adminApi.archiveUrgencyRule(ruleId);
        await refresh();
      }}
      onArchiveDocumentType={async (documentTypeId) => {
        await adminApi.archiveDocumentType(documentTypeId);
        await refresh();
      }}
      onArchiveReminderSetting={async (settingId) => {
        await adminApi.archiveReminderSetting(settingId);
        await refresh();
      }}
      onArchiveTemplate={async (templateId) => {
        await adminApi.archiveTemplate(templateId);
        await refresh();
      }}
      onArchiveInvoicePdfTemplate={async (templateId) => {
        await adminApi.archiveInvoicePdfTemplate(templateId);
        await refresh();
      }}
      onArchiveTeamMember={async (memberId) => {
        await adminApi.archiveTeamMember(memberId);
        await refresh();
      }}
      onCreateDocumentType={async (payload) => {
        await adminApi.createDocumentType(payload);
        await refresh();
      }}
      onCreateReminderSetting={async (payload) => {
        await adminApi.createReminderSetting(payload);
        await refresh();
      }}
      onCreateRbacRole={async (payload) => {
        await adminApi.createRbacRole(payload);
        await refresh();
      }}
      onCreateAdminUser={async (payload) => {
        const result = await adminApi.createAdminUser(payload);
        await refresh();
        return result;
      }}
      onCreatePricingSlab={async (payload) => {
        await adminApi.createPricingSlab(payload);
        await refresh();
      }}
      onCreateConsultationMode={async (payload) => {
        await adminApi.createConsultationMode(payload);
        await refresh();
      }}
      onCreateCountryPricing={async (payload) => {
        await adminApi.createCountryPricing(payload);
        await refresh();
      }}
      onCreatePriceOverride={async (payload) => {
        await adminApi.createPriceOverride(payload);
        await refresh();
      }}
      onCreateService={async (payload) => {
        await adminApi.createServiceCatalogService(payload);
        await refresh();
      }}
      onCreateServiceDomain={async (payload) => {
        await adminApi.createServiceCatalogDomain(payload);
        await refresh();
      }}
      onCreateUrgencyRule={async (payload) => {
        await adminApi.createUrgencyRule(payload);
        await refresh();
      }}
      onCreateTemplate={async (payload) => {
        await adminApi.createTemplate(payload);
        await refresh();
      }}
      onCreateInvoicePdfTemplate={async (payload) => {
        await adminApi.uploadInvoicePdfTemplate(payload);
        await refresh();
      }}
      onCreateTeamMember={async (payload) => {
        await adminApi.createTeamMember(payload);
        await refresh();
      }}
      onEnableTeamMemberLogin={async (memberId, payload) => {
        const result = await adminApi.enableTeamMemberLogin(memberId, payload);
        await refresh();
        return result;
      }}
      onUpdateTeamMemberLogin={async (memberId, payload) => {
        const result = await adminApi.updateTeamMemberLogin(memberId, payload);
        await refresh();
        return result;
      }}
      onSetDefaultTemplate={async (templateId) => {
        await adminApi.setDefaultTemplate(templateId);
        await refresh();
      }}
      onArchiveRbacRole={async (roleId) => {
        await adminApi.archiveRbacRole(roleId);
        await refresh();
      }}
      onAssignRbacUserRole={async (userId, roleCode) => {
        await adminApi.assignRbacUserRole(userId, roleCode);
        await refresh();
      }}
      onRemoveRbacUserRole={async (userId, roleCode) => {
        await adminApi.removeRbacUserRole(userId, roleCode);
        await refresh();
      }}
      onUpdateDocumentType={async (documentTypeId, payload) => {
        await adminApi.updateDocumentType(documentTypeId, payload);
        await refresh();
      }}
      onUpdateNotificationTypeSetting={async (typeCode, payload) => {
        await adminApi.updateNotificationTypeSetting(typeCode, payload);
        await refresh();
      }}
      onUpdatePricingSlab={async (slabId, payload) => {
        await adminApi.updatePricingSlab(slabId, payload);
        await refresh();
      }}
      onUpdateConsultationMode={async (modeCode, payload) => {
        await adminApi.updateConsultationMode(modeCode, payload);
        await refresh();
      }}
      onUpdateCountryPricing={async (countryPricingId, payload) => {
        await adminApi.updateCountryPricing(countryPricingId, payload);
        await refresh();
      }}
      onUpdatePriceOverride={async (overrideId, payload) => {
        await adminApi.updatePriceOverride(overrideId, payload);
        await refresh();
      }}
      onUpdateReminderSetting={async (settingId, payload) => {
        await adminApi.updateReminderSetting(settingId, payload);
        await refresh();
      }}
      onUpdateService={async (serviceId, payload) => {
        await adminApi.updateServiceCatalogService(serviceId, payload);
        await refresh();
      }}
      onUpdateServiceDomain={async (domainCode, payload) => {
        await adminApi.updateServiceCatalogDomain(domainCode, payload);
        await refresh();
      }}
      onUpdateUrgencyRule={async (ruleId, payload) => {
        await adminApi.updateUrgencyRule(ruleId, payload);
        await refresh();
      }}
      onUpdateTemplate={async (templateId, payload) => {
        await adminApi.updateTemplate(templateId, payload);
        await refresh();
      }}
      onUpdateTeamMember={async (memberId, payload) => {
        await adminApi.updateTeamMember(memberId, payload);
        await refresh();
      }}
      onUpdateInvoicePdfTemplate={async (templateId, payload) => {
        await adminApi.updateInvoicePdfTemplate(templateId, payload);
        await refresh();
      }}
      onUpdateInvoiceSettings={async (payload) => {
        await adminApi.updateInvoiceSettings(payload);
        await refresh();
      }}
      onUpdateAdminUser={async (userId, payload) => {
        const result = await adminApi.updateAdminUser(userId, payload);
        await refresh();
        return result;
      }}
      onUpdatePlatformSetting={async (key, payload) => {
        await adminApi.updatePlatformSetting(key, payload);
        await refresh();
      }}
      onUpdateRbacRole={async (roleId, payload) => {
        await adminApi.updateRbacRole(roleId, payload);
        await refresh();
      }}
      onUpdateRbacRolePermissions={async (roleId, payload) => {
        await adminApi.updateRbacRolePermissions(roleId, payload);
        await refresh();
      }}
      workspace={data}
    />
  );
};
