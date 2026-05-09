# Legal and Tax Review Package

Last updated: 2026-05-07

Prepared for CA/legal review. This document exports current public legal copy, invoice wording, and invoice tax settings from the codebase and the current configured database state. It is not legal or tax advice. Production-safe placeholder pages and neutral wording were added for review, but final legal claims still require CA/legal approval.

## Review Scope

Global LMG is currently described as an intermediary legal consultancy, lawyer-matching, coordination, and support platform. The product intentionally avoids claiming that Global LMG is a law firm or directly provides legal representation.

Review is requested for:

- Terms / onboarding acceptance wording.
- Privacy Policy.
- Refund and cancellation wording.
- Not-a-law-firm and no-direct-legal-advice disclaimers.
- Invoice wording and invoice footer.
- GST/SAC/tax configuration.
- Reverse charge and exempt notes.
- Data retention and operational logging language.

## Source Files

- Public legal content: `frontend/src/app/content/site/legal.ts`
- Terms page: `frontend/src/app/pages/TermsOfServicePage.tsx`
- Refund/cancellation page: `frontend/src/app/pages/RefundCancellationPolicyPage.tsx`
- Shared footer/compliance note: `frontend/src/app/content/site/common.ts`
- Public service copy: `frontend/src/app/content/site/services.ts`
- FAQ copy: `frontend/src/app/content/site/faq.ts`
- Client signup acceptance text: `frontend/src/app/components/auth/AuthModal.tsx`
- Invoice settings service: `admin_backend/src/modules/settings/invoiceSettings.ts`
- Invoice tax calculation: `admin_backend/src/modules/billing/tax.ts`
- Invoice template rendering: `admin_backend/src/modules/billing/invoiceTemplateRendering.ts`
- Client invoice rendering model: `backend/src/modules/domain/invoiceTemplateRendering.ts`
- Invoice settings migration defaults: `backend/src/lib/schemaMigrations.ts`

## Terms / Onboarding Acceptance

A draft Terms of Service page now exists at `/terms`. It is a placeholder prepared for legal review and contains explicit `TODO (CA/legal review)` markers.

Current signup flow requires the user to accept Terms, Refund and Cancellation Policy, Legal Disclaimer, and Privacy Policy. The current validation message is:

> You must accept the Terms, Refund and Cancellation Policy, Legal Disclaimer, and Privacy Policy.

Current signup links:

- `/terms`
- `/refund-cancellation`
- `/legal-disclaimer`
- `/privacy`

Legal review needed:

- Approve final standalone Terms of Service / Terms of Use wording before public launch.
- Whether signup should require acceptance of Terms, Privacy Policy, Legal Disclaimer, refund/cancellation policy, and communication consent separately.
- Whether the current acceptance wording is enough for client portal account creation.
- Governing law, dispute resolution, limitation-of-liability, payment, cancellation, refund, data-retention, and third-party professional-services wording.

## Privacy Policy Export

Current title: `Privacy Policy`

Current last-updated date: `March 31, 2026`

Current intro:

> Global LMG operates a public site and authenticated client portal for intake, coordination, documents, billing, messages, and related support workflows. This policy explains what data the current site and portal handle, and where third-party services may process information independently.

Current section headings:

- What this site collects today
- Client intake and portal workflows
- How contact data is used
- Cookies and local storage
- Security and retention
- Contact and requests

Key current privacy wording:

- Public pages do not intentionally include advertising pixels, analytics SDKs, or account tracking in the shipped front-end code.
- Hosting and reverse-proxy request logs may include IP address, user agent, referrer, requested path, response status, and approximate request time.
- Client intake may happen through the authenticated portal or separately configured external intake forms.
- Users are told not to send payment card data, passwords, or unnecessary highly sensitive information through public forms or unsecured channels.
- Submitted details may be used to respond to requests, assess follow-up, and coordinate next steps with internal teams or independently engaged professionals.
- Submitting an enquiry does not, by itself, create an attorney-client relationship.
- Portal uses essential session and CSRF cookies.
- Email/SMS provider delivery events are retained for operational delivery
  support for 90 days. Raw provider webhook payloads are minimized before
  storage; direct recipient fields may still contain email addresses or phone
  numbers and should be treated as PII. Production database and backup storage
  should provide encryption at rest.
- Region-specific rights handling, retention schedules, and portal account controls need review before production.

Current footer note:

> This document reflects the current public-site and authenticated portal beta. It should be reviewed again before production launch.

## Cookie Notice Export

Current title: `Cookie Notice`

Current last-updated date: `March 31, 2026`

Current section headings:

- Current public-site behavior
- Third-party services
- Portal session cookies

Key current cookie wording:

- The public frontend does not intentionally ship analytics cookies, ad-tech tags, or personalization beacons.
- External form, calendar, meeting, or third-party platforms may set their own cookies independently.
- The portal requires essential cookies for login state, verification flows, CSRF defense, and abuse prevention.
- Optional analytics, marketing, or profiling cookies should remain disabled unless separately reviewed and disclosed.

## Legal Disclaimer Export

Current title: `Legal Disclaimer`

Current last-updated date: `March 31, 2026`

Current intro:

> Global LMG publishes this site for general informational and business-development purposes. Please read the following limits before relying on any site content or submitting an enquiry.

Current section headings:

- No legal advice
- No attorney-client relationship
- Secure intake and document handling
- Jurisdiction and availability
- Accuracy and updates

Key current disclaimer wording:

- Site content is general information only and should not be treated as legal advice for any specific matter, jurisdiction, or transaction.
- Users should seek advice from qualified counsel before acting or refraining from action based on site content.
- Browsing, reading, or sending a preliminary enquiry does not create an attorney-client relationship.
- Engagement only exists after appropriate conflicts, onboarding, and formal engagement steps have been completed.
- Public forms and public email should not be used for highly confidential, export-controlled, regulated, or otherwise sensitive documents.
- Service availability and professional admission in a jurisdiction are not guaranteed.

## Not-A-Law-Firm / Intermediary Disclaimer Export

Shared public compliance note:

> Global LMG is an intermediary legal consultancy and lawyer-matching platform. We are not a law firm and do not provide direct legal advice.

FAQ copy:

> Global LMG is an intermediary legal consultancy and lawyer-matching platform. We help clients coordinate legal workflows and connect with independently engaged professionals.

FAQ direct legal advice answer:

> No. Public-site content and portal workflows are for coordination and operational support. Clients should rely on qualified counsel for legal advice.

General admin template footer:

> Global LMG is an intermediary legal consultancy, lawyer-matching, coordination, and support platform. Global LMG is not a law firm and does not provide legal representation.

Invoice footer:

> Global LMG provides intermediary legal consultancy, coordination, and support services. This invoice is not for legal representation by Global LMG.

Legal review needed:

- Whether “legal consultancy” is acceptable wording in all intended jurisdictions.
- Whether “lawyer-matching” creates any regulated referral, solicitation, advertising, fee-sharing, or bar-council issues.
- Whether “support services” needs a more specific definition.
- Whether public service names/copy should be softened where they imply representation.

## Service Copy Needing Legal Review

Current public service catalog includes:

- `Get me a Counsel`
- `Document review and compliance check`
- `Legal Drafting`
- `Case Merit assessment and Case strategy`
- `Litigation Monitoring - Shadow Counsel`
- `Liaison and Field support`
- `Court technology and digital support`

Previously sensitive wording referenced expert representation for hearings and litigation support, which could imply Global LMG directly provides representation.

Replacement now in public service catalog:

> Coordination support for connecting clients with independently engaged counsel for hearings, disputes, and specialized legal workflows

Review needed:

- Confirm whether the replacement wording is acceptable and whether any further service names or summaries need jurisdiction-specific softening.
- Confirm whether “Shadow Counsel,” “case strategy,” “legal drafting,” and “compliance check” need jurisdiction-specific disclaimers.

## Refund / Cancellation Wording Export

A draft public refund/cancellation page now exists at `/refund-cancellation`. It is a placeholder prepared for legal/CA review and contains explicit `TODO (CA/legal review)` markers.

Current product behavior has:

- Admin refund recording.
- Refund audit and notification behavior.
- Event cancellation behavior.
- Invoice statuses such as `refunded`, `void`, `overdue`, and `paid`.

Current refund notification body:

> A refund of {{currency}} {{amount}} has been initiated against your payment.

Current event cancellation notification body pattern:

> The scheduled event was cancelled.

or, if a reason is supplied:

> The scheduled event was cancelled. Reason: {{reason}}

Legal review needed:

- Approve final public refund/cancellation policy wording before launch.
- Refund eligibility rules for consultation, coordination, field support, document review, counsel matching, and in-person/travel-heavy services.
- Whether platform fees, third-party professional fees, filing costs, travel costs, taxes, payment gateway fees, and disbursements are refundable.
- Required cancellation windows for scheduled calls, meetings, in-person support, and urgent requests.
- Whether invoice/payment screens must link to refund/cancellation terms before payment.

## Current Invoice Settings Export

These values were read from the current configured database using a read-only query. No secrets were printed.

| Field | Current value |
| --- | --- |
| Business legal name | `Global LMG` |
| Billing display name | `Global LMG` |
| Business state | `Not configured` |
| Business address | Not configured |
| Business phone | Not configured |
| Business email | Not configured |
| Business website | Not configured |
| Invoice prefix | `INV` |
| GSTIN | Not configured |
| Default SAC code | Not configured |
| GST enabled | Yes |
| Default GST rate | `18%` |
| Tax mode | `forward_charge` |
| Prices include tax | No |
| Fallback tax type | `igst` |
| Payment terms days | `7` |
| Payment instructions | Not configured |
| Invoice terms | Not configured |
| Reverse charge note | `Tax payable under reverse charge where applicable.` |
| Invoice footer | `Global LMG provides intermediary legal consultancy, coordination, and support services. This invoice is not for legal representation by Global LMG.` |

## Current Invoice Template Wording Export

Current active invoice template:

| Field | Current value |
| --- | --- |
| Template name | `Standard Invoice Note` |
| Subject | Not configured |
| Body | `Thank you for using {{platformName}} for coordination and support services. Invoice {{invoiceNumber}} is due by {{dueDate}}.` |
| Version | `1` |
| Default | Yes |

Fallback invoice subject:

> Invoice {{invoiceNumber}} from Global LMG

Fallback invoice body:

> Invoice {{invoiceNumber}} has been issued for {{clientName}} regarding {{matterTitle}}.
>
> Line items:
> {{lineItems}}
>
> Subtotal: {{subtotal}}
> Tax: {{taxTotal}}
> Total: {{total}}
> Amount due: {{amountDue}}

Fallback invoice footer:

> Global LMG provides intermediary legal consultancy, coordination, and support services. This invoice is not for legal representation by Global LMG.

Generated payment terms fallback:

- If `payment_terms_days > 0`: `Payment due within N day(s).`
- If `payment_terms_days = 0`: `Payment due by {{dueDate}}.`

## GST / SAC / Tax Logic Export

Current tax calculation behavior:

- If GST is disabled, no tax lines are applied and the note says GST/tax is disabled in invoice settings.
- If tax mode is `exempt`, no tax lines are applied and the note says GST/tax is marked exempt for the invoice.
- If tax mode is `reverse_charge`, no tax lines are applied and the reverse charge note is shown.
- If tax mode is `forward_charge`, GST is applied using the configured default GST rate.
- If prices include tax, the taxable value and tax are backed out of the line amount.
- If prices exclude tax, tax is added on top of the line amount.
- If business state and client state match, tax is split into CGST and SGST.
- If business state and client state differ, IGST is applied.
- If business state or client state is missing, the configured fallback tax type is used.

Current fallback is `igst`, but business state is not configured. That means unknown-state invoices can default to IGST.

Review needed:

- Confirm whether IGST fallback is correct when business/client state is missing.
- Confirm whether invoices should be blocked until business state and GSTIN are configured.
- Confirm if intra-state CGST/SGST and inter-state IGST logic is sufficient for all customer/entity types.
- Confirm if international clients should be GST, zero-rated export of services, exempt, or another tax treatment.
- Confirm if reverse charge should be per-client/per-invoice rather than global setting.

## CA / Legal Review Questions

### GST / SAC

1. What SAC code should Global LMG use for each service category?
2. Is a flat 18% GST rate correct for all current offerings?
3. Should services have different SAC/GST mappings?
4. Should invoice generation be blocked when GSTIN, business state, address, or SAC is not configured?
5. Is IGST an acceptable fallback when client state is unknown?
6. How should non-India clients be invoiced?
7. Should tax treatment depend on client country, place of supply, service type, or recipient GST registration?

### Reverse Charge / Exempt

1. When, if ever, should reverse charge apply to Global LMG invoices?
2. Should reverse charge be global, client-specific, service-specific, or invoice-specific?
3. What exact reverse charge note should appear on invoices?
4. When should exempt tax mode apply?
5. What exact exempt wording should appear on invoices?

### Invoice Wording

1. Is the current invoice footer acceptable?
2. Should invoices say “coordination and support services” instead of “legal consultancy”?
3. Should invoices include a no-attorney-client-relationship note?
4. Should invoices distinguish Global LMG platform fees from third-party counsel/professional fees?
5. Should invoices include disbursement/travel/filing-cost wording?
6. Should invoice PDFs include registered office, CIN/LLP/company identifiers, GSTIN, PAN, or bank details?
7. Are payment terms of 7 days acceptable?

### Intermediary / Lawyer-Matching Disclaimer

1. Is “intermediary legal consultancy / lawyer-matching platform” legally safe in target markets?
2. Does “lawyer-matching” require bar council, referral, advertising, or solicitor regulation review?
3. Should public services avoid words such as “legal representation,” “legal drafting,” and “case strategy” unless delivered by independent counsel?
4. What exact disclaimer should appear during request submission and payment?
5. Should client-facing counsel assignment screens clarify that external counsel are independent professionals?

### Terms / Refund / Cancellation

1. Is a standalone Terms of Service page required before accepting client registrations?
2. What refund policy applies to consultation fees, urgent fees, in-person coordination, document review, and field support?
3. Are travel/transport costs non-refundable or separately recoverable?
4. What cancellation window applies to scheduled calls and in-person support?
5. Should payment screens require explicit acceptance of refund/cancellation terms?
6. Should urgent requests have different refund or cancellation rules?

### Privacy / Data Retention

1. What retention period applies to client accounts, requests, matters, messages, documents, invoices, audit logs, and security logs?
2. What jurisdiction-specific privacy rights must be supported before production?
3. Should public pages include analytics/cookie consent if analytics is later enabled?
4. What exact wording is needed for provider processing by Resend, Twilio, Google Calendar/Meet, ClamAV, and object storage providers?
5. Should uploaded documents have a legal hold / deletion policy?

## Recommended Pre-Launch Legal/TAX Decisions

- Approve final Terms of Service / Terms of Use.
- Approve final Refund and Cancellation Policy.
- Approve Privacy Policy and retention schedule.
- Approve Legal Disclaimer and request-flow disclaimer.
- Approve invoice footer, payment terms, and payment instructions.
- Configure GSTIN, business state, business address, phone, email, website, SAC, and payment instructions.
- Confirm GST rate, SAC, IGST/CGST/SGST logic, reverse charge behavior, and exempt behavior.
- Review public service copy for claims that imply Global LMG directly provides legal representation.

## Invoice Settings Production Checklist

TODO (CA/legal review): before production invoice issuance, configure and approve:

- GSTIN.
- Default SAC code, or service-specific SAC mapping if required.
- Business state for CGST/SGST versus IGST logic.
- Business legal name and billing display name.
- Business address.
- Business phone and business email.
- Business website, if it should appear on invoices.
- Payment instructions and payment terms.
- Tax mode, reverse charge note, exempt wording, invoice footer, and any registered-office/company identifiers required on invoice PDFs.

## Notes

- Draft Terms and Refund/Cancellation placeholder pages were added for review.
- Unsafe public wording that implied Global LMG directly provides legal representation was replaced with neutral coordination/intermediary wording.
- The invoice settings export reflects the current database at the time of this document.
- The public legal content still carries beta-oriented notes and should be reviewed before production launch.
