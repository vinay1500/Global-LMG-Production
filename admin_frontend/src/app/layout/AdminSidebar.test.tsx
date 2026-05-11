import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminSidebar } from './AdminSidebar';
import { useAdminSession } from '../providers/AdminSessionProvider';

vi.mock('../providers/AdminSessionProvider', () => ({
  useAdminSession: vi.fn(),
}));

const mockedUseAdminSession = vi.mocked(useAdminSession);

const renderSidebar = (permissionCodes: string[]) => {
  mockedUseAdminSession.mockReturnValue({
    changePassword: vi.fn(),
    currentUser: {
      displayName: 'Scoped User',
      email: 'scoped@example.local',
      id: 'user_1',
      mustRotatePassword: false,
      permissionCodes,
      roleCodes: [],
    },
    errorMessage: null,
    isAuthenticated: true,
    isReady: true,
    mustRotatePassword: false,
    refreshSession: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    verifyMfa: vi.fn(),
  });

  render(
    <MemoryRouter>
      <AdminSidebar onSignOut={vi.fn()} />
    </MemoryRouter>
  );
};

beforeEach(() => {
  mockedUseAdminSession.mockReset();
});

describe('AdminSidebar scoped navigation', () => {
  it('shows billing-only navigation for billing staff', () => {
    renderSidebar(['invoice.view', 'payment.view', 'refund.view']);

    expect(screen.getByRole('link', { name: /billing & ledger/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /dashboard/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /clients/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /matters desk/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /messages/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /documents/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /audit log/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /settings/i })).not.toBeInTheDocument();
  });

  it('shows assigned matter workspaces but hides billing and settings for advocates', () => {
    renderSidebar([
      'matter.view_assigned',
      'document.view_assigned',
      'document.download_assigned',
      'message.view_assigned',
      'message.send_assigned',
      'event.view_assigned',
    ]);

    expect(screen.getByRole('link', { name: /matters desk/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /messages/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /documents/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /meetings/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /billing & ledger/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /audit log/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /settings/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^clients$/i })).not.toBeInTheDocument();
  });

  it('shows assigned clients and matters for internal case staff without global admin modules', () => {
    renderSidebar([
      'client_account.view_assigned',
      'matter.view_assigned',
      'matter.update_assigned',
      'document.view_assigned',
      'message.view_assigned',
      'message.send_assigned',
      'event.view_assigned',
    ]);

    expect(screen.getByRole('link', { name: /^clients$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /matters desk/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /messages/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /documents/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /meetings/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /billing & ledger/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /audit log/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /settings/i })).not.toBeInTheDocument();
  });
});
