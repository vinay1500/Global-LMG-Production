import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequirePermission } from './RequirePermission';
import { useAdminSession } from '../providers/AdminSessionProvider';

vi.mock('../providers/AdminSessionProvider', () => ({
  useAdminSession: vi.fn(),
}));

const mockedUseAdminSession = vi.mocked(useAdminSession);

const renderProtectedRoute = (permissionCodes: string[]) => {
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
    <MemoryRouter initialEntries={['/billing']}>
      <Routes>
        <Route element={<RequirePermission permission="invoice.view" />}>
          <Route element={<div>Billing workspace</div>} path="/billing" />
        </Route>
        <Route element={<div>Access denied</div>} path="/forbidden" />
      </Routes>
    </MemoryRouter>
  );
};

beforeEach(() => {
  mockedUseAdminSession.mockReset();
});

describe('RequirePermission', () => {
  it('redirects unauthorized scoped users to access denied', () => {
    renderProtectedRoute(['matter.view_assigned']);

    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByText('Billing workspace')).not.toBeInTheDocument();
  });

  it('renders the protected route when the required permission is present', () => {
    renderProtectedRoute(['invoice.view']);

    expect(screen.getByText('Billing workspace')).toBeInTheDocument();
    expect(screen.queryByText('Access denied')).not.toBeInTheDocument();
  });
});
