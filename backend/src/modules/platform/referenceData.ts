export const ROLE_SEEDS = [
  {
    code: 'client',
    description: 'Portal client user',
    name: 'Client',
  },
  {
    code: 'case_manager',
    description: 'Operational case manager',
    name: 'Case Manager',
  },
  {
    code: 'billing_admin',
    description: 'Finance and billing operations owner',
    name: 'Billing Admin',
  },
  {
    code: 'ops_admin',
    description: 'Platform operations administrator',
    name: 'Ops Admin',
  },
];

export const PERMISSION_SEEDS = [
  ['dashboard.view', 'dashboard', 'view', 'View dashboard data'],
  ['client_account.view', 'client_account', 'view', 'View client accounts'],
  ['client_account.manage', 'client_account', 'manage', 'Manage client accounts'],
  ['counsel_partner.view', 'counsel_partner', 'view', 'View counsel partners'],
  ['counsel_partner.manage', 'counsel_partner', 'manage', 'Manage counsel partners'],
  ['matter.view', 'matter', 'view', 'View matters'],
  ['matter.update', 'matter', 'update', 'Update matters'],
  ['document.view', 'document', 'view', 'View documents'],
  ['document.manage', 'document', 'manage', 'Manage documents'],
  ['message.send', 'message', 'send', 'Send thread messages'],
  ['notification.view', 'notification', 'view', 'View admin notifications'],
  ['notification.manage', 'notification', 'manage', 'Manage admin notifications'],
  ['audit.view', 'audit', 'view', 'View audit events'],
  ['document.download', 'document', 'download', 'Download documents'],
  ['event.view', 'event', 'view', 'View events'],
  ['event.manage', 'event', 'manage', 'Manage events'],
  ['invoice.view', 'invoice', 'view', 'View invoices'],
  ['invoice.manage', 'invoice', 'manage', 'Manage invoices'],
  ['payment.view', 'payment', 'view', 'View payments'],
  ['payment.manage', 'payment', 'manage', 'Manage payments'],
  ['refund.view', 'refund', 'view', 'View refunds'],
  ['refund.manage', 'refund', 'manage', 'Manage refunds'],
  ['settings.manage', 'settings', 'manage', 'Manage mutable platform settings'],
  ['rbac.manage', 'rbac', 'manage', 'Manage roles and permissions'],
] as const;

export const ROLE_PERMISSION_SEEDS: Array<[string, string[]]> = [
  [
    'client',
    [
      'dashboard.view',
      'client_account.view',
      'matter.view',
      'document.view',
      'document.download',
      'message.send',
      'event.view',
      'invoice.view',
      'payment.view',
      'refund.view',
    ],
  ],
  [
    'case_manager',
    [
      'dashboard.view',
      'client_account.view',
      'counsel_partner.view',
      'matter.view',
      'matter.update',
      'document.view',
      'document.manage',
      'document.download',
      'message.send',
      'notification.view',
      'event.view',
      'event.manage',
      'invoice.view',
      'payment.view',
      'refund.view',
    ],
  ],
  [
    'billing_admin',
    [
      'dashboard.view',
      'client_account.view',
      'invoice.view',
      'invoice.manage',
      'notification.view',
      'payment.view',
      'payment.manage',
      'refund.view',
      'refund.manage',
    ],
  ],
  [
    'ops_admin',
    [
      'dashboard.view',
      'client_account.view',
      'client_account.manage',
      'counsel_partner.view',
      'counsel_partner.manage',
      'matter.view',
      'matter.update',
      'document.view',
      'document.manage',
      'document.download',
      'message.send',
      'notification.view',
      'notification.manage',
      'audit.view',
      'event.view',
      'event.manage',
      'invoice.view',
      'invoice.manage',
      'payment.view',
      'payment.manage',
      'refund.view',
      'refund.manage',
      'settings.manage',
      'rbac.manage',
    ],
  ],
];

export const CONSULTATION_MODE_SEEDS = [
  ['phone', 'Phone Call', 1],
  ['video', 'Video Consultation', 2],
  ['in-person', 'In-Person Consultation', 3],
] as const;

export const REQUEST_STATUS_SEEDS = [
  ['draft_payment_pending', 'Draft Payment Pending', 0, 0],
  ['submitted', 'Submitted', 1, 0],
  ['new-lead', 'New Lead', 2, 0],
  ['awaiting-verification', 'Awaiting Verification', 3, 0],
  ['consultation-scheduled', 'Consultation Scheduled', 4, 0],
  ['consultation-completed', 'Consultation Completed', 5, 0],
  ['fee-pending', 'Fee Pending', 6, 0],
  ['converted', 'Converted', 7, 1],
  ['lost-closed', 'Lost / Closed', 8, 1],
] as const;

export const MATTER_STAGE_SEEDS = [
  ['request-received', 'Request Received', 1, 1, 0],
  ['verification-call', 'Verification Call', 2, 1, 0],
  ['consultation', 'Consultation', 3, 1, 0],
  ['action-plan', 'Action Plan', 4, 1, 0],
  ['resolution', 'Resolution', 5, 1, 1],
] as const;

export const MATTER_OPERATIONAL_STATUS_SEEDS = [
  ['new-lead', 'New Lead', 1, 0],
  ['awaiting-verification', 'Awaiting Verification', 2, 0],
  ['verification-scheduled', 'Verification Scheduled', 3, 0],
  ['consultation-completed', 'Consultation Completed', 4, 0],
  ['fee-pending', 'Fee Pending', 5, 0],
  ['package-ready', 'Package Ready', 6, 0],
  ['awaiting-payment', 'Awaiting Payment', 7, 0],
  ['paid', 'Paid', 8, 0],
  ['work-in-progress', 'Work In Progress', 9, 0],
  ['immediate', 'Immediate', 10, 0],
  ['completed', 'Completed', 11, 1],
  ['archived', 'Archived', 12, 1],
] as const;

export const INVOICE_STATUS_SEEDS = [
  ['draft', 'Draft', 1, 0],
  ['sent', 'Sent', 2, 0],
  ['pending', 'Pending', 3, 0],
  ['paid', 'Paid', 4, 1],
  ['overdue', 'Overdue', 5, 0],
  ['void', 'Void', 6, 1],
  ['refunded', 'Refunded', 7, 1],
] as const;

export const PAYMENT_STATUS_SEEDS = [
  ['initiated', 'Initiated', 1, 0],
  ['authorized', 'Authorized', 2, 0],
  ['captured', 'Captured', 3, 1],
  ['failed', 'Failed', 4, 1],
  ['cancelled', 'Cancelled', 5, 1],
  ['refunded', 'Refunded', 6, 1],
  ['partially-refunded', 'Partially Refunded', 7, 1],
] as const;

export const THREAD_STATUS_SEEDS = [
  ['active', 'Active', 1, 0],
  ['waiting', 'Waiting', 2, 0],
  ['resolved', 'Resolved', 3, 1],
] as const;

export const EVENT_STATUS_SEEDS = [
  ['upcoming', 'Upcoming', 1, 0],
  ['completed', 'Completed', 2, 1],
  ['cancelled', 'Cancelled', 3, 1],
  ['rescheduled', 'Rescheduled', 4, 0],
] as const;

export const NOTIFICATION_TYPE_SEEDS = [
  ['matter_update', 'Matter Update', 1],
  ['payment_reminder', 'Payment Reminder', 2],
  ['invoice_generated', 'Invoice Generated', 3],
  ['event_reminder', 'Event Reminder', 4],
  ['message_received', 'Message Received', 5],
  ['document_uploaded', 'Document Uploaded', 6],
  ['proposal', 'Proposal', 7],
  ['system', 'System', 8],
] as const;

export const LEGAL_DOMAIN_SEEDS = [
  ['civil', 'Civil Law', 1],
  ['criminal', 'Criminal Law', 2],
  ['corporate', 'Corporate Law', 3],
  ['family', 'Family Law', 4],
  ['property', 'Property Law', 5],
  ['labor', 'Labor & Employment', 6],
  ['tax', 'Tax Law', 7],
  ['intellectual-property', 'Intellectual Property', 8],
  ['consumer', 'Consumer Law', 9],
  ['other', 'Other', 10],
] as const;

export const SERVICE_SEEDS = [
  ['get-counsel', 'property', 'Get Me a Counsel', 'Lawyer matching and counsel coordination', 1, 0],
  ['document-review', 'corporate', 'Document Review and Compliance Check', 'Document coordination and compliance support', 2, 0],
  ['legal-drafting', 'corporate', 'Legal Drafting', 'Drafting coordination for contracts, notices, and applications', 3, 0],
  ['case-assessment', 'civil', 'Case Assessment and Strategy', 'Intake review and coordination planning', 4, 0],
  ['litigation-monitoring', 'civil', 'Litigation Monitoring', 'Independent counsel coordination and case tracking', 5, 0],
  ['liaison-support', 'criminal', 'Liaison and Field Support', 'Registry, filing, and field coordination support', 6, 0],
  ['court-technology', 'tax', 'Court Technology and Digital Support', 'Digital hearing and e-court support coordination', 7, 1],
] as const;

export const PRICING_SERVICE_SLAB_SEEDS = [
  [1, 1, 10000, null],
  [2, 2, 15000, null],
  [3, null, 15000, 5000],
] as const;

export const PRICING_URGENCY_RULE_SEEDS = [
  ['standard', 'Standard', 'flat', 0, 1],
  ['within-6hrs', 'Within 6 Hours', 'flat', 2500, 2],
  ['within-2hrs', 'Within 2 Hours', 'flat', 5000, 3],
] as const;

export const PRICING_CONSULTATION_RULE_SEEDS = [
  ['phone', 'flat', 0],
  ['video', 'flat', 1000],
  ['in-person', 'flat', 5000],
] as const;

export const TAX_RATE_SEEDS = [
  ['gst-18', 'GST', 18, 'IN', '2024-01-01'],
] as const;
