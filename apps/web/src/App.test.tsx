import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { StrictMode } from 'react';
import type { Session } from './api';

const session: Session = {
  companies: [
    {
      id: 'company-a',
      code: 'a',
      name: 'Company Alpha',
      membershipId: 'member-a',
    },
    {
      id: 'company-b',
      code: 'b',
      name: 'Company Beta',
      membershipId: 'member-b',
    },
  ],
  csrfToken: 'test-csrf',
  user: {
    id: 'user',
    displayName: 'Payroll Owner',
    email: 'owner@example.com',
  },
};
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
});

describe('authenticated payroll workspace', () => {
  it('saves a PAYE template using operator headings and explicit layout settings', async () => {
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/session')) return json(session);
      if (url.endsWith('/payroll-overview'))
        return json({
          counts: {
            employees: 0,
            missingSalaries: 0,
            verifiedRules: 0,
            periods: 0,
          },
          runs: [],
          latest: null,
        });
      if (init.method === 'POST') return json({ id: 'template' }, 201);
      return json({ items: [], banks: [] });
    });
    vi.stubGlobal('fetch', fetcher);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /ZRA returns/ }));
    fireEvent.click(
      screen.getByText('PAYE export templates & reference guides'),
    );
    fireEvent.change(screen.getByLabelText('Template name'), {
      target: { value: 'PAYE review layout' },
    });
    fireEvent.change(screen.getByLabelText(/Layout source/), {
      target: { value: 'Operator review copy' },
    });
    fireEvent.change(screen.getByLabelText('Delimiter'), {
      target: { value: ',' },
    });
    fireEvent.change(screen.getByLabelText('Include header row?'), {
      target: { value: 'yes' },
    });
    fireEvent.change(screen.getByLabelText('Column 1 heading'), {
      target: { value: 'TPIN' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save template version' }),
    );
    expect(
      await screen.findByText(/Template version saved/),
    ).toBeInTheDocument();
    const write = fetcher.mock.calls.find(
      ([url, init]) => url.endsWith('/operations') && init.method === 'POST',
    );
    expect(JSON.parse(write![1].body as string)).toEqual({
      kind: 'export_template',
      settings: {
        name: 'PAYE review layout',
        sourceReference: 'Operator review copy',
        delimiter: ',',
        header: true,
        purpose: 'paye_return',
        columns: [
          { field: 'employeeTpin', header: 'TPIN' },
          { field: 'taxableIncome', header: 'Taxable income' },
          { field: 'paye', header: 'PAYE' },
        ],
      },
    });
  });

  it('submits preview rows in StrictMode and reports server validation failures without downloading', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/session')) return json(session);
      if (url.endsWith('/payroll-overview'))
        return json({
          counts: {
            employees: 0,
            missingSalaries: 0,
            verifiedRules: 0,
            periods: 0,
          },
          runs: [],
          latest: null,
        });
      if (url.endsWith('/export-preview'))
        return json({ message: 'Account number is missing or invalid' }, 400);
      return json({
        items: [
          {
            id: 'template',
            kind: 'export_template',
            settings: {
              name: 'Salary review',
              purpose: 'salary_batch',
              bank: 'Example bank',
              columns: [
                { field: 'accountNumber', header: 'Account' },
                { field: 'netPay', header: 'Amount' },
                { field: 'reference', header: 'Reference' },
              ],
            },
          },
        ],
        banks: [{ name: 'Example bank', connectionStatus: 'not_connected' }],
      });
    });
    vi.stubGlobal('fetch', fetcher);
    render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    fireEvent.click(
      await screen.findByRole('button', { name: /Bank batches/ }),
    );
    await screen.findAllByRole('option', { name: 'Salary review' });
    fireEvent.change(screen.getByLabelText('Export template'), {
      target: { value: 'template' },
    });
    for (const [label, value] of [
      ['Account', 'bad'],
      ['Amount', '100.00'],
      ['Reference', 'PAY-1'],
    ]) {
      fireEvent.change(screen.getByLabelText(`Row 1 ${label}`), {
        target: { value },
      });
    }
    fireEvent.click(
      screen.getByRole('button', { name: 'Download CSV preview' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Account number is missing or invalid',
    );
    expect(fetcher).toHaveBeenCalledWith(
      '/api/companies/company-a/operations/export-preview',
      expect.objectContaining({
        body: JSON.stringify({
          templateId: 'template',
          rows: [
            { accountNumber: 'bad', netPay: '100.00', reference: 'PAY-1' },
          ],
        }),
        signal: expect.objectContaining({ aborted: false }),
      }),
    );
  });
  it('restores sessions without displaying invented payroll figures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/auth/session')
          ? json(session)
          : json({
              counts: {
                employees: 0,
                missingSalaries: 0,
                verifiedRules: 0,
                periods: 0,
              },
              runs: [],
              latest: null,
            }),
      ),
    );
    render(<App />);
    expect(
      await screen.findByRole('heading', { name: 'Overview' }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Awaiting calculation/)).toBeInTheDocument();
    expect(
      await screen.findByText(/No verified configuration covers today/),
    ).toBeInTheDocument();
  });
  it('signs in through the actual auth contract and signs out with CSRF', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/auth/session'))
        return json({ message: 'Authentication required' }, 401);
      if (url.endsWith('/auth/login')) return json(session);
      if (url.endsWith('/payroll-overview'))
        return json({
          counts: {
            employees: 0,
            missingSalaries: 0,
            verifiedRules: 0,
            periods: 0,
          },
          runs: [],
          latest: null,
        });
      if (url.endsWith('/auth/logout'))
        return new Response(null, { status: 204 });
      return json({ items: [] });
    });
    vi.stubGlobal('fetch', fetcher);
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Email address'), {
      target: { value: 'owner@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'A long private passphrase' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(
      await screen.findByRole('heading', { name: 'Overview' }),
    ).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/auth/login',
      expect.objectContaining({
        credentials: 'same-origin',
        method: 'POST',
        body: JSON.stringify({
          email: 'owner@example.com',
          password: 'A long private passphrase',
        }),
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(
      await screen.findByRole('heading', { name: 'Sign in to your workspace' }),
    ).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/auth/logout',
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-csrf-token': 'test-csrf' }),
      }),
    );
  });
  it('shows rejected login errors without opening company screens', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ message: 'Invalid credentials' }, 401)),
    );
    render(<App />);
    fireEvent.change(await screen.findByLabelText('Email address'), {
      target: { value: 'owner@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'wrong-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Invalid credentials',
    );
    expect(
      screen.queryByRole('navigation', { name: 'Main navigation' }),
    ).not.toBeInTheDocument();
  });
  it('creates employees and refreshes the company directory', async () => {
    let saved = false;
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/auth/session')) return json(session);
      if (url.endsWith('/payroll-overview'))
        return json({
          counts: {
            employees: 0,
            missingSalaries: 0,
            verifiedRules: 0,
            periods: 0,
          },
          runs: [],
          latest: null,
        });
      if (url.endsWith('/employees')) {
        saved = true;
        return json({ id: 'employee' }, 201);
      }
      if (url.endsWith('/employees/employee'))
        return json({
          id: 'employee',
          employeeNumber: 'EMP001',
          givenName: 'Jane',
          familyName: 'Banda',
          status: 'active',
          version: 1,
          employments: [],
        });
      if (url.includes('/employees?'))
        return json({
          items: saved
            ? [
                {
                  id: 'employee',
                  employeeNumber: 'EMP001',
                  givenName: 'Jane',
                  familyName: 'Banda',
                  status: 'active',
                },
              ]
            : [],
        });
      return json({ items: [], method: init.method });
    });
    vi.stubGlobal('fetch', fetcher);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /People/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add employee' }));
    for (const [label, value] of [
      ['Employee number', 'EMP001'],
      ['First name', 'Jane'],
      ['Last name', 'Banda'],
      ['Job title', 'Accountant'],
      ['Employment start', '2026-09-01'],
    ]) {
      fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save employee' }));
    expect(await screen.findByText('Jane Banda')).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/companies/company-a/employees',
      expect.objectContaining({
        body: JSON.stringify({
          employeeNumber: 'EMP001',
          givenName: 'Jane',
          familyName: 'Banda',
          employment: { positionTitle: 'Accountant', startsOn: '2026-09-01' },
        }),
        headers: expect.objectContaining({ 'x-csrf-token': 'test-csrf' }),
      }),
    );
  });
  it('clears company data and ignores an old pending response on company switch', async () => {
    let finishOld: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/auth/session')) return json(session);
        if (url.endsWith('/payroll-overview'))
          return json({
            counts: {
              employees: 0,
              missingSalaries: 0,
              verifiedRules: 0,
              periods: 0,
            },
            runs: [],
            latest: null,
          });
        if (url.includes('company-a/employees'))
          return new Promise<Response>((resolve) => {
            finishOld = resolve;
          });
        if (url.includes('company-b/employees'))
          return json({
            items: [
              {
                id: 'b',
                employeeNumber: 'B1',
                givenName: 'Beta',
                familyName: 'Person',
                status: 'active',
              },
            ],
          });
        return json({ items: [] });
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /People/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add employee' }));
    fireEvent.change(screen.getByLabelText('First name'), {
      target: { value: 'Unsaved Alpha' },
    });
    await waitFor(() => expect(finishOld).toBeDefined());
    fireEvent.change(screen.getByLabelText('COMPANY'), {
      target: { value: 'company-b' },
    });
    expect(await screen.findByText('Beta Person')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add employee' }));
    expect(screen.getByLabelText('First name')).toHaveValue('');
    await act(async () => {
      finishOld?.(
        json({
          items: [
            {
              id: 'a',
              employeeNumber: 'A1',
              givenName: 'Alpha',
              familyName: 'Secret',
              status: 'active',
            },
          ],
        }),
      );
    });
    expect(screen.queryByText('Alpha Secret')).not.toBeInTheDocument();
    expect(screen.getByText('Beta Person')).toBeInTheDocument();
  });
  it('clears sensitive screens after a session expires', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/auth/session')) return json(session);
        if (url.endsWith('/payroll-overview'))
          return json({
            counts: {
              employees: 0,
              missingSalaries: 0,
              verifiedRules: 0,
              periods: 0,
            },
            runs: [],
            latest: null,
          });
        if (url.includes('/employees'))
          return json({ message: 'Authentication required' }, 401);
        return json({ items: [] });
      }),
    );
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /People/ }));
    expect(
      await screen.findByRole('heading', { name: 'Sign in to your workspace' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Your session has expired',
    );
  });
  it('labels bank and TaxOnline export templates as unverified previews', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/auth/session')
          ? json(session)
          : url.endsWith('/payroll-overview')
            ? json({
                counts: {
                  employees: 0,
                  missingSalaries: 0,
                  verifiedRules: 0,
                  periods: 0,
                },
                runs: [],
                latest: null,
              })
            : json({
                items: [],
                banks: [
                  { name: 'Example bank', connectionStatus: 'not_connected' },
                ],
              }),
      ),
    );
    render(<App />);
    fireEvent.click(
      await screen.findByRole('button', { name: /Bank batches/ }),
    );
    expect(await screen.findByText('Not connected')).toBeInTheDocument();
    expect(screen.getByText(/No funds can be sent/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /ZRA returns/ }));
    fireEvent.click(
      screen.getByText('PAYE export templates & reference guides'),
    );
    expect(screen.getByText(/not certified return files/)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Column mapping' }),
    ).toBeInTheDocument();
  });
});
