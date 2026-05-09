# Admin MFA Recovery

Global LMG admin accounts can enable authenticator-app MFA from **My Account → Security**.

## Normal Sign-In

1. Enter admin email/phone and password.
2. If MFA is enabled, enter the 6-digit code from the authenticator app.
3. A recovery code can be used instead of the authenticator code during sign-in. Each recovery code works once.

## Enrollment

1. Open **My Account → Security**.
2. Select **Set Up Authenticator App**.
3. Scan the QR code or enter the provisioning URI in the authenticator app.
4. Enter the first 6-digit code to enable MFA.
5. Store the generated recovery codes securely. They are shown only once.

## Rollout Modes

Ops administrators can control rollout from **Settings → General Platform → Admin MFA rollout mode**:

- `Off`: MFA remains optional per admin account.
- `Warn`: admins without MFA see enrollment guidance, but sign-in is not blocked.
- `Enforce`: admin sign-in requires MFA. The setting cannot be enabled until every active admin account has MFA enrolled.

Use `Warn` while onboarding admins. Verify at least one ops administrator has working MFA and recovery codes before switching to `Enforce`.

## Disabling MFA

Admins can disable MFA from **My Account → Security** only after confirming both:

- current password
- current authenticator code

MFA cannot be disabled while the global rollout mode is `Enforce`.

## Lost Authenticator

Use a saved recovery code at sign-in. If the authenticator and recovery codes are both unavailable, an ops administrator must perform a manual account recovery after verifying identity out of band. Do not ask the affected admin for old TOTP codes or recovery codes.

## Security Notes

- TOTP secrets are encrypted at rest.
- Recovery codes are stored as hashes.
- MFA failures are rate-limited and audited.
- MFA secrets, TOTP codes, and recovery codes must never be logged or shared in support tickets.
