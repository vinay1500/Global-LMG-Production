import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClientDirectory } from './ClientDirectory';
import { MatterDeskAdmin } from './MatterDeskAdmin';

describe('scoped workspace empty states', () => {
  it('shows assigned-client copy for scoped case staff with no assigned clients', () => {
    render(
      <ClientDirectory
        assignedScope
        clients={[]}
        onSelectClient={vi.fn()}
      />
    );

    expect(screen.getByText('No assigned clients yet.')).toBeInTheDocument();
    expect(
      screen.getByText('Assigned clients will appear here once you are linked to their matters.')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /clear search & filters/i })).not.toBeInTheDocument();
  });

  it('shows assigned-matter copy for scoped staff or advocates with no assigned matters', () => {
    render(
      <MatterDeskAdmin
        assignedScope
        clients={[]}
        matters={[]}
        onViewMatter={vi.fn()}
      />
    );

    expect(screen.getByText('No assigned matters yet.')).toBeInTheDocument();
    expect(
      screen.getByText('Assigned matters will appear here once an ops admin links you to a matter.')
    ).toBeInTheDocument();
  });
});
