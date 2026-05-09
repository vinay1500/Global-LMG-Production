import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  UserCircle,
} from 'lucide-react';
import { useSearchParams } from 'react-router';
import { WorkspaceState } from '../../components/shared/WorkspaceState';
import { useAsyncResource } from '../../hooks/useAsyncResource';
import { authApi } from '../../lib/api/auth';
import type {
  AdminAccountPreferences,
  UpdateAdminPreferencesPayload,
  UpdateAdminProfilePayload,
} from '../../lib/api/contracts';
import { useAdminSession } from '../../providers/AdminSessionProvider';

type AccountTab = 'password' | 'preferences' | 'profile' | 'security';

type ProfileForm = {
  city: string;
  displayName: string;
  jobTitle: string;
  phone: string;
  state: string;
};

type PreferencesForm = {
  avatarColor: string;
  dateFormat: string;
  defaultLandingPath: AdminAccountPreferences['defaultLandingPath'];
  densityCode: AdminAccountPreferences['densityCode'];
  inAppNotificationsEnabled: boolean;
  timezoneName: string;
};

const ACCOUNT_TABS: Array<{ icon: React.ComponentType<{ className?: string }>; id: AccountTab; label: string }> = [
  { icon: UserCircle, id: 'profile', label: 'My Profile' },
  { icon: KeyRound, id: 'password', label: 'Change Password' },
  { icon: ShieldCheck, id: 'security', label: 'Security' },
  { icon: SlidersHorizontal, id: 'preferences', label: 'Preferences' },
];

const LANDING_OPTIONS: Array<{ label: string; value: AdminAccountPreferences['defaultLandingPath'] }> = [
  { label: 'Dashboard', value: '/dashboard' },
  { label: 'Clients', value: '/clients' },
  { label: 'Matters', value: '/matters' },
  { label: 'Requests', value: '/requests' },
  { label: 'Billing', value: '/billing' },
  { label: 'Messages', value: '/messages' },
  { label: 'Documents', value: '/documents' },
  { label: 'Meetings', value: '/meetings' },
  { label: 'Reports', value: '/reports' },
  { label: 'Notifications', value: '/notifications' },
];

const DATE_FORMAT_OPTIONS = ['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'];
const TIMEZONE_OPTIONS = ['Asia/Kolkata', 'UTC', 'Asia/Dubai', 'Europe/London', 'America/New_York'];

const buildProfileForm = (account: Awaited<ReturnType<typeof authApi.getAccount>>): ProfileForm => ({
  city: account.profile.city,
  displayName: account.profile.displayName,
  jobTitle: account.profile.jobTitle,
  phone: account.profile.phone,
  state: account.profile.state,
});

const buildPreferencesForm = (
  account: Awaited<ReturnType<typeof authApi.getAccount>>
): PreferencesForm => ({
  avatarColor: account.preferences.avatarColor,
  dateFormat: account.preferences.dateFormat,
  defaultLandingPath: account.preferences.defaultLandingPath,
  densityCode: account.preferences.densityCode,
  inAppNotificationsEnabled: account.preferences.inAppNotificationsEnabled,
  timezoneName: account.preferences.timezoneName,
});

export const AdminAccountPage = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab') as AccountTab | null;
  const [activeTab, setActiveTab] = useState<AccountTab>(
    requestedTab && ACCOUNT_TABS.some((tab) => tab.id === requestedTab) ? requestedTab : 'profile'
  );
  const { changePassword, refreshSession } = useAdminSession();
  const { data, errorMessage, isLoading, refresh } = useAsyncResource(() => authApi.getAccount(), []);
  const [profileForm, setProfileForm] = useState<ProfileForm | null>(null);
  const [preferencesForm, setPreferencesForm] = useState<PreferencesForm | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [formError, setFormError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [mfaSetup, setMfaSetup] = useState<Awaited<ReturnType<typeof authApi.startMfaEnrollment>> | null>(null);
  const [mfaVerificationCode, setMfaVerificationCode] = useState('');
  const [mfaDisableCode, setMfaDisableCode] = useState('');
  const [mfaDisablePassword, setMfaDisablePassword] = useState('');
  const [mfaRecoveryCodes, setMfaRecoveryCodes] = useState<string[]>([]);

  useEffect(() => {
    if (requestedTab && ACCOUNT_TABS.some((tab) => tab.id === requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [requestedTab]);

  useEffect(() => {
    if (!data) {
      return;
    }

    setProfileForm(buildProfileForm(data));
    setPreferencesForm(buildPreferencesForm(data));
  }, [data]);

  const changeTab = (tab: AccountTab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
    setFormError('');
    setStatusMessage('');
  };

  if (isLoading && !data) {
    return (
      <WorkspaceState
        description="Loading your admin profile, password controls, and saved preferences."
        title="Loading Account"
      />
    );
  }

  if (errorMessage && !data) {
    return (
      <WorkspaceState
        actionLabel="Try Again"
        description={errorMessage}
        onAction={() => void refresh().catch(() => undefined)}
        title="Account Unavailable"
      />
    );
  }

  if (!data || !profileForm || !preferencesForm) {
    return null;
  }

  const mfaRequirementMode = data.security.mfaRequirementMode || 'off';
  const mfaRolloutLabel =
    mfaRequirementMode === 'enforce'
      ? 'Required'
      : mfaRequirementMode === 'warn'
        ? 'Enrollment requested'
        : 'Optional';

  const saveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setStatusMessage('');

    if (!profileForm.displayName.trim()) {
      setFormError('Display name is required.');
      return;
    }

    const payload: UpdateAdminProfilePayload = {
      city: profileForm.city.trim() || null,
      displayName: profileForm.displayName.trim(),
      jobTitle: profileForm.jobTitle.trim() || null,
      phone: profileForm.phone.trim() || null,
      state: profileForm.state.trim() || null,
    };

    setIsSaving(true);
    try {
      await authApi.updateProfile(payload);
      await refreshSession();
      await refresh();
      setStatusMessage('Profile updated.');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to update profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const savePreferences = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setStatusMessage('');

    const payload: UpdateAdminPreferencesPayload = {
      avatarColor: preferencesForm.avatarColor,
      dateFormat: preferencesForm.dateFormat,
      defaultLandingPath: preferencesForm.defaultLandingPath,
      densityCode: preferencesForm.densityCode,
      inAppNotificationsEnabled: preferencesForm.inAppNotificationsEnabled,
      timezoneName: preferencesForm.timezoneName,
    };

    setIsSaving(true);
    try {
      await authApi.updatePreferences(payload);
      await refreshSession();
      await refresh();
      setStatusMessage('Preferences saved.');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to save preferences.');
    } finally {
      setIsSaving(false);
    }
  };

  const savePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setStatusMessage('');

    if (newPassword !== confirmPassword) {
      setFormError('New password and confirmation must match.');
      return;
    }

    setIsSaving(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setStatusMessage('Password changed. Other admin sessions for this account were signed out.');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to change password.');
    } finally {
      setIsSaving(false);
    }
  };

  const startMfaSetup = async () => {
    setFormError('');
    setStatusMessage('');
    setMfaRecoveryCodes([]);
    setIsSaving(true);
    try {
      setMfaSetup(await authApi.startMfaEnrollment());
      setStatusMessage('Scan the QR code, then enter the first code from your authenticator app.');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to start MFA setup.');
    } finally {
      setIsSaving(false);
    }
  };

  const verifyMfaSetup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setStatusMessage('');
    setIsSaving(true);
    try {
      const result = await authApi.verifyMfaEnrollment({ code: mfaVerificationCode.trim() });
      setMfaRecoveryCodes(result.recoveryCodes);
      setMfaSetup(null);
      setMfaVerificationCode('');
      await refresh();
      setStatusMessage('Authenticator app verification is enabled. Store your recovery codes securely.');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to verify MFA setup.');
    } finally {
      setIsSaving(false);
    }
  };

  const disableMfa = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError('');
    setStatusMessage('');
    setIsSaving(true);
    try {
      await authApi.disableMfa({
        code: mfaDisableCode.trim(),
        currentPassword: mfaDisablePassword,
      });
      setMfaDisableCode('');
      setMfaDisablePassword('');
      setMfaRecoveryCodes([]);
      await refresh();
      setStatusMessage('Authenticator app verification disabled.');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Unable to disable MFA.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[#E6E4DD] bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#8C8981]">My Account</p>
            <h1
              className="mt-2 text-3xl text-[#2C2B29]"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              Admin Profile & Preferences
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-[#5A5751]">
              Manage your own admin identity, password, and workspace preferences. Global LMG access controls remain governed by Roles & Permissions.
            </p>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-[#E6E4DD] bg-[#FCFBF8] px-4 py-3">
            <div
              className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold text-white"
              style={{ backgroundColor: data.preferences.avatarColor }}
            >
              {data.profile.displayName.slice(0, 1).toUpperCase()}
            </div>
            <div>
              <p className="text-sm font-medium text-[#2C2B29]">{data.profile.displayName}</p>
              <p className="text-xs text-[#8C8981]">{data.profile.email}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-[#E6E4DD] bg-white p-2 shadow-sm">
        {ACCOUNT_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
                isActive ? 'bg-[#2C2B29] text-white' : 'text-[#5A5751] hover:bg-[#F4F1EA]'
              }`}
              key={tab.id}
              onClick={() => changeTab(tab.id)}
              type="button"
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {formError ? (
        <div className="flex items-start gap-2 rounded-xl border border-[#F5C2C7] bg-[#FDE8EC] p-4 text-sm text-[#9E3D3D]">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          {formError}
        </div>
      ) : null}
      {statusMessage ? (
        <div className="flex items-start gap-2 rounded-xl border border-[#B8D8C2] bg-[#F4FBF5] p-4 text-sm text-[#337348]">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
          {statusMessage}
        </div>
      ) : null}

      {activeTab === 'profile' ? (
        <form className="rounded-2xl border border-[#E6E4DD] bg-white p-6 shadow-sm" onSubmit={saveProfile}>
          <SectionTitle
            description="Update your display information. Email and roles are controlled by admin provisioning and RBAC."
            icon={UserCircle}
            title="Profile"
          />
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            <AccountInput
              label="Display name"
              onChange={(value) => setProfileForm((current) => current && { ...current, displayName: value })}
              value={profileForm.displayName}
            />
            <AccountInput disabled label="Email" onChange={() => undefined} value={data.profile.email} />
            <AccountInput
              label="Phone"
              onChange={(value) => setProfileForm((current) => current && { ...current, phone: value })}
              value={profileForm.phone}
            />
            <AccountInput
              label="Job title"
              onChange={(value) => setProfileForm((current) => current && { ...current, jobTitle: value })}
              value={profileForm.jobTitle}
            />
            <AccountInput
              label="City"
              onChange={(value) => setProfileForm((current) => current && { ...current, city: value })}
              value={profileForm.city}
            />
            <AccountInput
              label="State"
              onChange={(value) => setProfileForm((current) => current && { ...current, state: value })}
              value={profileForm.state}
            />
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {data.profile.roleCodes.map((roleCode) => (
              <span className="rounded-full border border-[#E6E4DD] bg-[#FCFBF8] px-3 py-1 text-xs text-[#5A5751]" key={roleCode}>
                {roleCode}
              </span>
            ))}
          </div>
          <SaveButton isSaving={isSaving} label="Save Profile" />
        </form>
      ) : null}

      {activeTab === 'password' ? (
        <form className="rounded-2xl border border-[#E6E4DD] bg-white p-6 shadow-sm" onSubmit={savePassword}>
          <SectionTitle
            description="Change your password using your current password. Other sessions are revoked after a successful change."
            icon={KeyRound}
            title="Change Password"
          />
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <PasswordInput
              label="Current password"
              onChange={setCurrentPassword}
              show={showPasswords}
              value={currentPassword}
            />
            <PasswordInput
              label="New password"
              minLength={12}
              onChange={setNewPassword}
              show={showPasswords}
              value={newPassword}
            />
            <PasswordInput
              label="Confirm new password"
              minLength={12}
              onChange={setConfirmPassword}
              show={showPasswords}
              value={confirmPassword}
            />
          </div>
          <button
            className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#E6E4DD] bg-[#FCFBF8] px-3 py-2 text-sm text-[#5A5751] transition hover:bg-[#F4F1EA]"
            onClick={() => setShowPasswords((current) => !current)}
            type="button"
          >
            {showPasswords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {showPasswords ? 'Hide passwords' : 'Show passwords'}
          </button>
          <SaveButton isSaving={isSaving} label="Change Password" />
        </form>
      ) : null}

      {activeTab === 'security' ? (
        <div className="rounded-2xl border border-[#E6E4DD] bg-white p-6 shadow-sm">
          <SectionTitle
            description="Add authenticator app verification for admin sign-in and keep recovery codes somewhere private."
            icon={ShieldCheck}
            title="Multi-factor Authentication"
          />

          {mfaRequirementMode !== 'off' && !data.security.mfaEnabled ? (
            <div className="mt-6 flex gap-3 rounded-xl border border-[#E0B35C] bg-[#FFF8EA] p-4 text-sm text-[#7A5A1B]">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Authenticator app MFA is part of the admin security rollout.</p>
                <p className="mt-1 text-xs">
                  Set up MFA now so this account remains ready when enforcement is enabled.
                </p>
              </div>
            </div>
          ) : null}

          <div className="mt-6 rounded-xl border border-[#E6E4DD] bg-[#FCFBF8] p-4">
            <p className="text-sm font-medium text-[#2C2B29]">
              Status: {data.security.mfaEnabled ? 'Enabled' : 'Not enabled'}
            </p>
            <p className="mt-1 text-xs text-[#8C8981]">Platform rollout: {mfaRolloutLabel}</p>
            {data.security.mfaEnabledAt ? (
              <p className="mt-1 text-xs text-[#8C8981]">
                Enabled {new Date(data.security.mfaEnabledAt).toLocaleString()}
              </p>
            ) : null}
          </div>

          {!data.security.mfaEnabled ? (
            <div className="mt-6 space-y-5">
              {!mfaSetup ? (
                <button
                  className="inline-flex items-center gap-2 rounded-lg bg-[#2C2B29] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#4A4946] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isSaving}
                  onClick={() => void startMfaSetup()}
                  type="button"
                >
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  Set Up Authenticator App
                </button>
              ) : (
                <form className="space-y-5" onSubmit={verifyMfaSetup}>
                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-[240px,1fr]">
                    <div className="rounded-xl border border-[#E6E4DD] bg-white p-3">
                      <img alt="Authenticator app QR code" className="h-auto w-full" src={mfaSetup.qrCodeDataUrl} />
                    </div>
                    <div>
                      <p className="text-sm text-[#5A5751]">
                        Scan this QR code with your authenticator app. If scanning is unavailable, use this provisioning URI.
                      </p>
                      <textarea
                        className="mt-3 h-28 w-full rounded-lg border border-[#E6E4DD] bg-white px-3 py-2 text-xs text-[#2C2B29] outline-none"
                        readOnly
                        value={mfaSetup.provisioningUri}
                      />
                      <div className="mt-4 max-w-xs">
                        <AccountInput
                          label="6-digit code"
                          onChange={setMfaVerificationCode}
                          value={mfaVerificationCode}
                        />
                      </div>
                    </div>
                  </div>
                  <SaveButton isSaving={isSaving} label="Enable MFA" />
                </form>
              )}

              {mfaRecoveryCodes.length ? (
                <div className="rounded-xl border border-[#B8D8C2] bg-[#F4FBF5] p-4">
                  <p className="text-sm font-medium text-[#337348]">Recovery codes</p>
                  <p className="mt-1 text-xs text-[#337348]">
                    These codes are shown once. Store them securely.
                  </p>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {mfaRecoveryCodes.map((code) => (
                      <code className="rounded-md bg-white px-3 py-2 text-sm text-[#2C2B29]" key={code}>
                        {code}
                      </code>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <form className="mt-6 space-y-5" onSubmit={disableMfa}>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <PasswordInput
                  label="Current password"
                  onChange={setMfaDisablePassword}
                  show={showPasswords}
                  value={mfaDisablePassword}
                />
                <AccountInput
                  label="6-digit authenticator code"
                  onChange={setMfaDisableCode}
                  value={mfaDisableCode}
                />
              </div>
              <SaveButton isSaving={isSaving} label="Disable MFA" />
              {mfaRequirementMode === 'enforce' ? (
                <p className="text-xs text-[#8C8981]">
                  MFA is currently enforced for admin access. Ask an ops administrator before disabling it.
                </p>
              ) : null}
            </form>
          )}
        </div>
      ) : null}

      {activeTab === 'preferences' ? (
        <form className="rounded-2xl border border-[#E6E4DD] bg-white p-6 shadow-sm" onSubmit={savePreferences}>
          <SectionTitle
            description="These preferences are scoped to your admin account and do not change global platform defaults."
            icon={SlidersHorizontal}
            title="Preferences"
          />
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            <AccountSelect
              label="Timezone"
              onChange={(value) =>
                setPreferencesForm((current) => current && { ...current, timezoneName: value })
              }
              options={TIMEZONE_OPTIONS.map((value) => ({ label: value, value }))}
              value={preferencesForm.timezoneName}
            />
            <AccountSelect
              label="Date format"
              onChange={(value) =>
                setPreferencesForm((current) => current && { ...current, dateFormat: value })
              }
              options={DATE_FORMAT_OPTIONS.map((value) => ({ label: value, value }))}
              value={preferencesForm.dateFormat}
            />
            <AccountSelect
              label="Default landing page"
              onChange={(value) =>
                setPreferencesForm(
                  (current) =>
                    current && {
                      ...current,
                      defaultLandingPath: value as AdminAccountPreferences['defaultLandingPath'],
                    }
                )
              }
              options={LANDING_OPTIONS}
              value={preferencesForm.defaultLandingPath}
            />
            <AccountSelect
              label="Density"
              onChange={(value) =>
                setPreferencesForm(
                  (current) =>
                    current && {
                      ...current,
                      densityCode: value as AdminAccountPreferences['densityCode'],
                    }
                )
              }
              options={[
                { label: 'Comfortable', value: 'comfortable' },
                { label: 'Compact', value: 'compact' },
              ]}
              value={preferencesForm.densityCode}
            />
            <AccountInput
              label="Avatar color"
              onChange={(value) => setPreferencesForm((current) => current && { ...current, avatarColor: value })}
              type="color"
              value={preferencesForm.avatarColor}
            />
            <label className="flex items-center gap-3 rounded-lg border border-[#E6E4DD] bg-[#FCFBF8] px-4 py-3">
              <input
                checked={preferencesForm.inAppNotificationsEnabled}
                className="h-4 w-4 accent-[#C19A5B]"
                onChange={(event) =>
                  setPreferencesForm(
                    (current) =>
                      current && {
                        ...current,
                        inAppNotificationsEnabled: event.target.checked,
                      }
                  )
                }
                type="checkbox"
              />
              <span className="text-sm text-[#2C2B29]">In-app admin notifications enabled</span>
            </label>
          </div>
          <SaveButton isSaving={isSaving} label="Save Preferences" />
        </form>
      ) : null}
    </div>
  );
};

const SectionTitle = ({
  description,
  icon: Icon,
  title,
}: {
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
}) => (
  <div className="flex items-start gap-3">
    <div className="rounded-lg bg-[#2C2B29] p-2 text-[#C19A5B]">
      <Icon className="h-4 w-4" />
    </div>
    <div>
      <h2 className="text-lg font-semibold text-[#2C2B29]">{title}</h2>
      <p className="mt-1 text-sm text-[#8C8981]">{description}</p>
    </div>
  </div>
);

const AccountInput = ({
  disabled = false,
  label,
  onChange,
  type = 'text',
  value,
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  type?: 'color' | 'text';
  value: string;
}) => (
  <label className="space-y-1.5">
    <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#A8A69F]">{label}</span>
    <input
      className="w-full rounded-lg border border-[#E6E4DD] bg-[#FCFBF8] px-3 py-2 text-sm text-[#2C2B29] outline-none transition focus:border-[#C19A5B] disabled:cursor-not-allowed disabled:text-[#8C8981]"
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      type={type}
      value={value}
    />
  </label>
);

const PasswordInput = ({
  label,
  minLength,
  onChange,
  show,
  value,
}: {
  label: string;
  minLength?: number;
  onChange: (value: string) => void;
  show: boolean;
  value: string;
}) => (
  <label className="space-y-1.5">
    <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#A8A69F]">{label}</span>
    <input
      className="w-full rounded-lg border border-[#E6E4DD] bg-[#FCFBF8] px-3 py-2 text-sm text-[#2C2B29] outline-none transition focus:border-[#C19A5B]"
      minLength={minLength}
      onChange={(event) => onChange(event.target.value)}
      required
      type={show ? 'text' : 'password'}
      value={value}
    />
  </label>
);

const AccountSelect = ({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) => (
  <label className="space-y-1.5">
    <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#A8A69F]">{label}</span>
    <select
      className="w-full rounded-lg border border-[#E6E4DD] bg-[#FCFBF8] px-3 py-2 text-sm text-[#2C2B29] outline-none transition focus:border-[#C19A5B]"
      onChange={(event) => onChange(event.target.value)}
      value={value}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </label>
);

const SaveButton = ({ isSaving, label }: { isSaving: boolean; label: string }) => (
  <button
    className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#2C2B29] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#4A4946] disabled:cursor-not-allowed disabled:opacity-60"
    disabled={isSaving}
    type="submit"
  >
    {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
    {label}
  </button>
);
