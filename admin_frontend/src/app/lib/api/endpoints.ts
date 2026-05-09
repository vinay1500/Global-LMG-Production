import { API_BASE_URL } from '../../config/env';

const joinApiPath = (path: string) => {
  if (API_BASE_URL.endsWith('/')) {
    return `${API_BASE_URL.slice(0, -1)}${path}`;
  }

  return `${API_BASE_URL}${path}`;
};

export const API_ENDPOINTS = {
  admin: {
    audit: () => joinApiPath('/v1/admin/audit'),
    auth: {
      me: () => joinApiPath('/v1/admin/auth/me'),
      mfaDisable: () => joinApiPath('/v1/admin/auth/mfa/disable'),
      mfaEnrollment: () => joinApiPath('/v1/admin/auth/mfa/enrollment'),
      mfaEnrollmentVerify: () => joinApiPath('/v1/admin/auth/mfa/enrollment/verify'),
      mfaSignIn: () => joinApiPath('/v1/admin/auth/mfa/sign-in'),
      password: () => joinApiPath('/v1/admin/auth/password'),
      passwordResetConfirm: () => joinApiPath('/v1/admin/auth/password-reset/confirm'),
      passwordResetRequest: () => joinApiPath('/v1/admin/auth/password-reset/request'),
      preferences: () => joinApiPath('/v1/admin/auth/preferences'),
      session: () => joinApiPath('/v1/admin/auth/session'),
      signIn: () => joinApiPath('/v1/admin/auth/sign-in'),
      signOut: () => joinApiPath('/v1/admin/auth/sign-out'),
    },
    billingWorkspace: () => joinApiPath('/v1/admin/billing/workspace'),
    createInvoice: () => joinApiPath('/v1/admin/billing/invoices'),
    invoiceDownload: (invoiceId: string) =>
      joinApiPath(`/v1/admin/billing/invoices/${encodeURIComponent(invoiceId)}/download`),
    createEvent: () => joinApiPath('/v1/admin/events'),
    createClient: () => joinApiPath('/v1/admin/clients'),
    createMatter: () => joinApiPath('/v1/admin/matters'),
    cancelEvent: (eventId: string) => joinApiPath(`/v1/admin/events/${eventId}/cancel`),
    eventCalendarSyncRetry: (eventId: string) =>
      joinApiPath(`/v1/admin/events/${eventId}/calendar-sync/retry`),
    createMatterAssignment: (matterId: string) => joinApiPath(`/v1/admin/matters/${matterId}/assignments`),
    replaceMatterAssignments: (matterId: string) => joinApiPath(`/v1/admin/matters/${matterId}/assignments`),
    createMatterNote: (matterId: string) => joinApiPath(`/v1/admin/matters/${matterId}/notes`),
    createRefund: () => joinApiPath('/v1/admin/billing/refunds'),
    recordPayment: () => joinApiPath('/v1/admin/billing/payments'),
    clientWorkspace: (clientId: string) => joinApiPath(`/v1/admin/clients/${clientId}`),
    clients: () => joinApiPath('/v1/admin/clients'),
    dashboard: () => joinApiPath('/v1/admin/dashboard'),
    documents: () => joinApiPath('/v1/admin/documents'),
    documentControls: (documentId: string) => joinApiPath(`/v1/admin/documents/${documentId}`),
    documentDetail: (documentId: string) => joinApiPath(`/v1/admin/documents/${documentId}`),
    documentDownload: (documentId: string) => joinApiPath(`/v1/admin/documents/${documentId}/download`),
    documentPreview: (documentId: string) => joinApiPath(`/v1/admin/documents/${documentId}/preview`),
    documentScan: (documentId: string) => joinApiPath(`/v1/admin/documents/${documentId}/scan`),
    documentVersionUpload: (documentId: string) =>
      joinApiPath(`/v1/admin/documents/${documentId}/versions`),
    events: () => joinApiPath('/v1/admin/events'),
    health: () => joinApiPath('/v1/admin/health'),
    matterWorkspace: (matterId: string) => joinApiPath(`/v1/admin/matters/${matterId}`),
    matters: () => joinApiPath('/v1/admin/matters'),
    matterDetails: (matterId: string) => joinApiPath(`/v1/admin/matters/${matterId}`),
    matterPackageArchive: (matterId: string, proposalVersion: number) =>
      joinApiPath(`/v1/admin/matters/${matterId}/package-proposals/${proposalVersion}/archive`),
    matterPackageDraft: (matterId: string) =>
      joinApiPath(`/v1/admin/matters/${matterId}/package-proposals/draft`),
    matterPackageOverride: (matterId: string) =>
      joinApiPath(`/v1/admin/matters/${matterId}/package-selection/override`),
    matterPackageProposals: (matterId: string) =>
      joinApiPath(`/v1/admin/matters/${matterId}/package-proposals`),
    matterPackagePublish: (matterId: string) =>
      joinApiPath(`/v1/admin/matters/${matterId}/package-proposals/publish`),
    matterStage: (matterId: string) => joinApiPath(`/v1/admin/matters/${matterId}/stage`),
    updateEvent: (eventId: string) => joinApiPath(`/v1/admin/events/${eventId}`),
    messageArchive: (threadId: string) => joinApiPath(`/v1/admin/messages/${threadId}/archive`),
    messageRead: (threadId: string) => joinApiPath(`/v1/admin/messages/${threadId}/read`),
    messageThreads: () => joinApiPath('/v1/admin/messages/threads'),
    messagesWorkspace: () => joinApiPath('/v1/admin/messages/workspace'),
    notifications: () => joinApiPath('/v1/admin/notifications'),
    notificationDismiss: (notificationId: string) =>
      joinApiPath(`/v1/admin/notifications/${notificationId}/dismiss`),
    notificationRead: (notificationId: string) =>
      joinApiPath(`/v1/admin/notifications/${notificationId}/read`),
    processReminders: () => joinApiPath('/v1/admin/reminders/process'),
    reminderRetry: (reminderId: string) => joinApiPath(`/v1/admin/reminders/${reminderId}/retry`),
    reminderWorkspace: () => joinApiPath('/v1/admin/reminders/workspace'),
    reportDrilldown: (kind: string) => joinApiPath(`/v1/admin/reports/drilldowns/${kind}`),
    reportDrilldownExport: (kind: string) =>
      joinApiPath(`/v1/admin/reports/drilldowns/${kind}/export.csv`),
    reportsWorkspace: () => joinApiPath('/v1/admin/reports/workspace'),
    requestApprove: (requestId: string) => joinApiPath(`/v1/admin/requests/${requestId}/approve`),
    requestConvert: (requestId: string) => joinApiPath(`/v1/admin/requests/${requestId}/convert`),
    requestDecline: (requestId: string) => joinApiPath(`/v1/admin/requests/${requestId}/decline`),
    requestInformation: (requestId: string) =>
      joinApiPath(`/v1/admin/requests/${requestId}/request-information`),
    requestsWorkspace: () => joinApiPath('/v1/admin/requests/workspace'),
    sendInvoice: (invoiceId: string) => joinApiPath(`/v1/admin/billing/invoices/${invoiceId}/send`),
    replyToThread: (threadId: string) => joinApiPath(`/v1/admin/messages/${threadId}/replies`),
    rbacWorkspace: () => joinApiPath('/v1/admin/rbac/workspace'),
    settingsRbac: () => joinApiPath('/v1/admin/settings/rbac'),
    settingsRbacRoles: () => joinApiPath('/v1/admin/settings/rbac/roles'),
    settingsRbacRole: (roleId: string) =>
      joinApiPath(`/v1/admin/settings/rbac/roles/${encodeURIComponent(roleId)}`),
    settingsRbacRoleArchive: (roleId: string) =>
      joinApiPath(`/v1/admin/settings/rbac/roles/${encodeURIComponent(roleId)}/archive`),
    settingsRbacRolePermissions: (roleId: string) =>
      joinApiPath(`/v1/admin/settings/rbac/roles/${encodeURIComponent(roleId)}/permissions`),
    settingsRbacUserRoles: (userId: string) =>
      joinApiPath(`/v1/admin/settings/rbac/users/${encodeURIComponent(userId)}/roles`),
    settingsRbacUserRole: (userId: string, roleId: string) =>
      joinApiPath(
        `/v1/admin/settings/rbac/users/${encodeURIComponent(userId)}/roles/${encodeURIComponent(roleId)}`
      ),
    search: () => joinApiPath('/v1/admin/search'),
    invoiceSettings: () => joinApiPath('/v1/admin/settings/invoice'),
    invoicePdfTemplates: () => joinApiPath('/v1/admin/settings/invoice/pdf-templates'),
    invoicePdfTemplate: (templateId: string) =>
      joinApiPath(`/v1/admin/settings/invoice/pdf-templates/${encodeURIComponent(templateId)}`),
    invoicePdfTemplateArchive: (templateId: string) =>
      joinApiPath(`/v1/admin/settings/invoice/pdf-templates/${encodeURIComponent(templateId)}/archive`),
    serviceCatalog: () => joinApiPath('/v1/admin/settings/service-catalog'),
    serviceCatalogServices: () => joinApiPath('/v1/admin/settings/service-catalog/services'),
    serviceCatalogService: (serviceId: string) =>
      joinApiPath(`/v1/admin/settings/service-catalog/services/${serviceId}`),
    serviceCatalogServiceArchive: (serviceId: string) =>
      joinApiPath(`/v1/admin/settings/service-catalog/services/${serviceId}/archive`),
    platformSettings: () => joinApiPath('/v1/admin/settings/platform'),
    platformSetting: (key: string) => joinApiPath(`/v1/admin/settings/platform/${encodeURIComponent(key)}`),
    pricingRules: () => joinApiPath('/v1/admin/settings/pricing-rules'),
    pricingRuleSlabs: () => joinApiPath('/v1/admin/settings/pricing-rules/slabs'),
    pricingRuleUrgencyRules: () => joinApiPath('/v1/admin/settings/pricing-rules/urgency'),
    pricingRuleConsultationModes: () =>
      joinApiPath('/v1/admin/settings/pricing-rules/consultation-modes'),
    pricingRuleCountryPricing: () =>
      joinApiPath('/v1/admin/settings/pricing-rules/country-pricing'),
    pricingRuleSlab: (slabId: string) => joinApiPath(`/v1/admin/settings/pricing-rules/slabs/${slabId}`),
    pricingRuleSlabArchive: (slabId: string) =>
      joinApiPath(`/v1/admin/settings/pricing-rules/slabs/${slabId}/archive`),
    pricingRuleUrgency: (ruleId: string) =>
      joinApiPath(`/v1/admin/settings/pricing-rules/urgency/${ruleId}`),
    pricingRuleUrgencyArchive: (ruleId: string) =>
      joinApiPath(`/v1/admin/settings/pricing-rules/urgency/${ruleId}/archive`),
    pricingRuleConsultationMode: (modeCode: string) =>
      joinApiPath(`/v1/admin/settings/pricing-rules/consultation-modes/${encodeURIComponent(modeCode)}`),
    pricingRuleConsultationModeArchive: (modeCode: string) =>
      joinApiPath(
        `/v1/admin/settings/pricing-rules/consultation-modes/${encodeURIComponent(modeCode)}/archive`
      ),
    pricingRuleCountryPricingRule: (countryPricingId: string) =>
      joinApiPath(`/v1/admin/settings/pricing-rules/country-pricing/${countryPricingId}`),
    pricingRuleCountryPricingArchive: (countryPricingId: string) =>
      joinApiPath(`/v1/admin/settings/pricing-rules/country-pricing/${countryPricingId}/archive`),
    pricingRulePriceOverrides: () =>
      joinApiPath('/v1/admin/settings/pricing-rules/price-overrides'),
    pricingRulePriceOverride: (overrideId: string) =>
      joinApiPath(`/v1/admin/settings/pricing-rules/price-overrides/${overrideId}`),
    pricingRulePriceOverrideArchive: (overrideId: string) =>
      joinApiPath(`/v1/admin/settings/pricing-rules/price-overrides/${overrideId}/archive`),
    settingsTemplates: () => joinApiPath('/v1/admin/settings/templates'),
    settingsTemplate: (templateId: string) => joinApiPath(`/v1/admin/settings/templates/${templateId}`),
    settingsTemplateArchive: (templateId: string) =>
      joinApiPath(`/v1/admin/settings/templates/${templateId}/archive`),
    settingsTemplateDefault: (templateId: string) =>
      joinApiPath(`/v1/admin/settings/templates/${templateId}/set-default`),
    settingsDocumentTypes: () => joinApiPath('/v1/admin/settings/document-types'),
    settingsDocumentType: (documentTypeId: string) =>
      joinApiPath(`/v1/admin/settings/document-types/${documentTypeId}`),
    settingsDocumentTypeArchive: (documentTypeId: string) =>
      joinApiPath(`/v1/admin/settings/document-types/${documentTypeId}/archive`),
    settingsNotifications: () => joinApiPath('/v1/admin/settings/notifications'),
    settingsNotificationType: (typeCode: string) =>
      joinApiPath(`/v1/admin/settings/notifications/types/${encodeURIComponent(typeCode)}`),
    settingsReminderOffsets: () => joinApiPath('/v1/admin/settings/notifications/reminder-offsets'),
    settingsReminderOffset: (settingId: string) =>
      joinApiPath(`/v1/admin/settings/notifications/reminder-offsets/${settingId}`),
    settingsReminderOffsetArchive: (settingId: string) =>
      joinApiPath(`/v1/admin/settings/notifications/reminder-offsets/${settingId}/archive`),
    settingsTeam: () => joinApiPath('/v1/admin/settings/team'),
    settingsTeamMembers: () => joinApiPath('/v1/admin/settings/team/members'),
    settingsTeamMember: (memberId: string) =>
      joinApiPath(`/v1/admin/settings/team/members/${memberId}`),
    settingsTeamMemberArchive: (memberId: string) =>
      joinApiPath(`/v1/admin/settings/team/members/${memberId}/archive`),
    settingsWorkspace: () => joinApiPath('/v1/admin/settings/workspace'),
    tasksWorkspace: () => joinApiPath('/v1/admin/tasks/workspace'),
    uploadDocument: () => joinApiPath('/v1/admin/documents/uploads'),
  },
};
