# Client API Contract Notes

The client web app uses `GET /api/v1/dashboard` as its primary aggregate endpoint for the
dashboard experience. That aggregate intentionally includes the list data the current UI needs,
including matters, documents, invoices, messages, notifications, and payment history.

The direct authenticated `/me/*` endpoints are retained as stable client API endpoints for detail
screens, downloads, explicit refreshes, and future mobile/API consumers. They should not be deleted
only because the current SPA can hydrate most list views from the dashboard aggregate.

Current direct client API endpoints include:

- `GET /me/client-account`
- `GET /me/matters`
- `GET /me/matters/:id`
- `GET /me/documents`
- `GET /me/documents/:id`
- `GET /me/events`
- `GET /me/invoices`
- `GET /me/invoices/:id`
- `GET /me/payments`
- `GET /me/refunds`

Payment history is displayed in the client Billing dashboard from the dashboard aggregate. Refund
history is exposed through `GET /me/refunds` as a direct read API and must remain filtered to the
current active client account without provider debug metadata.
