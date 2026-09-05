import { StrictMode } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FnbBatch } from './FnbBatch';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function fillForm() {
  fireEvent.change(screen.getByLabelText(/FNB debit account/), {
    target: { value: '62000031451' },
  });
  fireEvent.change(screen.getByLabelText('FNB payment action date'), {
    target: { value: '2026-09-05' },
  });
  for (const [label, value] of [
    ['Recipient name', 'Jane Banda'],
    ['Recipient account', '00123456789'],
    ['Account type', '1'],
    ['Branch code', '260006'],
    ['Amount', '2500.00'],
    ['Own reference', 'EMP001'],
    ['Recipient reference', 'SALARY'],
  ]) {
    fireEvent.change(screen.getByLabelText(`FNB row 1 ${label}`), {
      target: { value },
    });
  }
  fireEvent.click(screen.getByRole('checkbox'));
}
describe('FNB bank-format review workflow', () => {
  it('downloads the API-generated file with CSRF and no live-payment claim', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(
      async () => new Response('BInSol - U ver 1.00\r\n', { status: 200 }),
    );
    vi.stubGlobal('fetch', fetcher);
    const createObjectURL = vi.fn(() => 'blob:fnb-review');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    render(
      <StrictMode>
        <FnbBatch base="/companies/a" csrf="csrf-test" />
      </StrictMode>,
    );
    fillForm();
    await act(async () => {
      fireEvent.submit(
        screen
          .getByRole('button', { name: 'Download FNB review file' })
          .closest('form')!,
      );
    });
    expect(screen.getByRole('status')).toHaveTextContent('No payment sent');
    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(fetcher).toHaveBeenCalledWith(
      '/api/companies/a/operations/fnb-zambia-preview',
      expect.objectContaining({
        method: 'POST',
        signal: expect.objectContaining({ aborted: false }),
        headers: expect.objectContaining({ 'x-csrf-token': 'csrf-test' }),
        body: JSON.stringify({
          ownAccount: '62000031451',
          actionDate: '2026-09-05',
          rows: [
            {
              recipientName: 'Jane Banda',
              recipientAccount: '00123456789',
              accountType: '1',
              branchCode: '260006',
              amount: '2500.00',
              ownReference: 'EMP001',
              recipientReference: 'SALARY',
            },
          ],
        }),
      }),
    );
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fnb-review');
  });
  it('displays validation failures without claiming a batch was generated', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              message:
                'FNB action date must be today or within the next 365 days',
            }),
            { status: 400 },
          ),
      ),
    );
    render(<FnbBatch base="/companies/a" csrf="csrf-test" />);
    fillForm();
    await act(async () => {
      fireEvent.submit(
        screen
          .getByRole('button', { name: 'Download FNB review file' })
          .closest('form')!,
      );
    });
    expect(screen.getByRole('alert')).toHaveTextContent('FNB action date');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('aborts a pending download when leaving the company screen', async () => {
    let resolve: ((response: Response) => void) | undefined;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((finish) => {
          resolve = finish;
        }),
    );
    vi.stubGlobal('fetch', fetcher);
    const createObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL });
    const view = render(<FnbBatch base="/companies/a" csrf="csrf-test" />);
    fillForm();
    fireEvent.submit(
      screen
        .getByRole('button', { name: 'Download FNB review file' })
        .closest('form')!,
    );
    view.unmount();
    await act(async () => {
      resolve?.(new Response('csv', { status: 200 }));
    });
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
