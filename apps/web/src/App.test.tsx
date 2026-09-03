import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('shows the completed Phase 2 foundations without claiming payroll exists', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    render(<App />);

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /Payroll built from rules you can prove/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Phase 2 · Domain foundation')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Workforce' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /PAYE, NAPSA, and NHIMA logic will only follow reviewed/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Checking runtime');
  });

  it('reports when the API and database are ready', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ status: 'ready' }), { status: 200 }),
        ),
      ),
    );
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('System ready');
    });
  });
});
