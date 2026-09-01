import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App';

describe('App', () => {
  it('identifies the product as a Phase 1 foundation', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: 'ZamPayroll' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Phase 1 foundation');
    expect(
      screen.getByText(
        'Payroll calculations and statutory rates are not implemented yet.',
      ),
    ).toBeInTheDocument();
  });
});
