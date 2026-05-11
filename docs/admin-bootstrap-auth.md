# Admin Bootstrap and Password Rotation

This repo uses the shared IAM tables for admin access:

- Users live in `users`.
- Password hashes and rotation flags live in `user_credentials`.
- Admin roles live in `user_roles`, joined to `roles` and `role_permissions`.
- Admin sessions live in `user_sessions`.

## Local Bootstrap

Set these values in `admin_backend/.env`. Keep the password only in local env files.

```env
ADMIN_BOOTSTRAP_EMAIL=admin@example.local
ADMIN_BOOTSTRAP_PASSWORD=<local temporary password>
ADMIN_BOOTSTRAP_NAME=Global LMG Admin
ADMIN_BOOTSTRAP_ROLE=ops_admin
ADMIN_BOOTSTRAP_FORCE_ROTATION=true
ADMIN_BOOTSTRAP_RESET_PASSWORD=false
```

Use `ops_admin` for the first production admin. `ADMIN_BOOTSTRAP_ROLE` only
supports `ops_admin`; scoped, operational, billing, client, and custom roles are
not bootstrap-safe. Provision all other roles through the normal in-app admin
workflows after the first admin exists.

Run:

```bash
cd admin_backend
npm run bootstrap:admin
```

The bootstrap script creates the admin user only when missing, assigns the configured admin role,
and never prints the password. If the user already has credentials, the script preserves the
existing password unless `ADMIN_BOOTSTRAP_RESET_PASSWORD=true` is set explicitly.

In production, the explicit script also requires:

```env
ADMIN_BOOTSTRAP_ENABLED=true
```

Do not leave production bootstrap enabled after the first controlled bootstrap operation.

## Local Login

Start the admin API and admin frontend:

```bash
cd admin_backend
npm run start

cd ../admin_frontend
npm run dev -- --host 127.0.0.1
```

Open:

```text
http://127.0.0.1:5174/login
```

If `ADMIN_BOOTSTRAP_FORCE_ROTATION=true`, the first successful sign-in creates a normal admin
session but redirects to `/change-password`. All protected admin routes stay blocked until the
password is changed.

## Auth Endpoints

- `GET /api/v1/admin/auth/session`
- `POST /api/v1/admin/auth/sign-in`
- `POST /api/v1/admin/auth/password`
- `POST /api/v1/admin/auth/sign-out`

Session cookie: `global_lmg_admin_session` by default.

CSRF cookie/header: `global_lmg_admin_csrf` by default, sent as `x-csrf-token` for mutations.
