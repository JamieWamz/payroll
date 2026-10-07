import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ActivateWorkspace } from './ActivateWorkspace';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('account access', () => {
  it('shows sign-in and lets a customer begin workspace creation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ message: 'Authentication is required' }, 401)),
    );
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Welcome back.' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Create your workspace' }),
    ).toBeInTheDocument();
    expect(screen.getByAltText('Wamz Technologies')).toHaveAttribute(
      'src',
      '/brand/wamz-technologies.svg',
    );
  });
  it('submits a self-service workspace registration', async () => {
    const session = {
      companies: [],
      csrfToken: 'test',
      user: { id: 'test', email: 'owner@example.com', displayName: 'Owner' },
    };
    const fetcher = vi.fn(async (url: string) =>
      json(
        url.endsWith('/auth/session')
          ? { message: 'Authentication is required' }
          : session,
        url.endsWith('/auth/session') ? 401 : 200,
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    render(<App />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Create your workspace' }),
    );
    fireEvent.change(screen.getByLabelText('Your name'), {
      target: { value: 'Owner' },
    });
    fireEvent.change(screen.getByLabelText('Company name'), {
      target: { value: 'Owner Payroll' },
    });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'owner@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'Correct horse battery staple 2026!' },
    });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'Correct horse battery staple 2026!' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        '/api/auth/register',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    const call = (
      fetcher.mock.calls as unknown as [string, RequestInit][]
    ).find(([url]) => url.endsWith('/auth/register'));
    expect(JSON.parse(call![1].body as string)).toEqual({
      companyCode: 'owner-payroll',
      companyName: 'Owner Payroll',
      displayName: 'Owner',
      email: 'owner@example.com',
      password: 'Correct horse battery staple 2026!',
    });
  });
  it('accepts only the displayed company and email from the workspace invitation', async () => {
    const token = 'a'.repeat(43);
    const done = vi.fn();
    const invitation = {
      email: 'owner@example.com',
      companyCode: 'invited-company',
      companyName: 'Invited Company',
    };
    const session = {
      companies: [],
      csrfToken: 'test',
      user: { id: 'test', email: invitation.email, displayName: 'Owner' },
    };
    const fetcher = vi.fn(async (url: string) =>
      json(url.endsWith('/workspace-invitation') ? invitation : session),
    );
    vi.stubGlobal('fetch', fetcher);
    render(<ActivateWorkspace token={token} done={done} cancel={() => {}} />);
    expect(await screen.findByText(/This invitation is for/)).toHaveTextContent(
      invitation.email,
    );
    expect(screen.queryByLabelText('Company name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Your name'), {
      target: { value: 'Owner' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'Correct horse battery staple 2026!' },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Accept invitation & set up payroll',
      }),
    );
    await waitFor(() => expect(done).toHaveBeenCalledWith(session));
    const call = (
      fetcher.mock.calls as unknown as [string, RequestInit][]
    ).find(([url]) => url.endsWith('/auth/register'));
    expect(JSON.parse(call![1].body as string)).toEqual({
      ...invitation,
      inviteToken: token,
      displayName: 'Owner',
      password: 'Correct horse battery staple 2026!',
    });
  });
  it('shows an unavailable invitation without offering account creation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ message: 'Invitation expired' }, 404)),
    );
    render(
      <ActivateWorkspace
        token={'b'.repeat(43)}
        done={() => {}}
        cancel={() => {}}
      />,
    );
    expect(await screen.findByText('Invitation expired')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Accept invitation & set up payroll',
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Back to sign in' }),
    ).toBeInTheDocument();
  });
});
