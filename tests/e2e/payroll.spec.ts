import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { Pool } from 'pg';

test('register, manage employee, calculate, finalize, export, record filing and restore session', async ({
  page,
}, testInfo) => {
  test.skip(
    !process.env['TEST_DATABASE_MIGRATION_URL'],
    'A migration connection is required to clean up synthetic test data.',
  );
  const marker = `browser-${randomUUID().slice(0, 8)}`;
  const email = `${marker}@example.com`;
  const password = 'Correct horse battery staple 2026!';
  let companyId = '';
  let userId = '';
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto('/');
    await page
      .getByRole('button', { name: 'New company? Create a workspace' })
      .click();
    await page.getByLabel('Your name').fill('Browser Test Owner');
    await page.getByLabel('Company name').fill('Payroll Browser Test');
    await page.getByLabel('Company code').fill(marker);
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create company account' }).click();
    await expect(
      page.getByRole('heading', { name: 'Overview', exact: true }),
    ).toBeVisible();
    const session = await page.evaluate(async () => {
      const response = await fetch('/api/auth/session');
      return response.json() as Promise<{
        companies: { id: string }[];
        user: { id: string };
        csrfToken: string;
      }>;
    });
    console.info('Browser: registration complete');
    companyId = session.companies[0]!.id;
    userId = session.user.id;
    const nav = async (name: string) => {
      console.info(`Browser: opening ${name}`);
      await page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('button', { name: new RegExp(`\\b${name}$`) })
        .click();
      await expect(
        page.getByRole('heading', { name, exact: true }),
      ).toBeVisible();
    };
    // Historical rules are explicitly synthetic test fixtures, isolated in this company.
    await page.evaluate(
      async ({ companyId, csrf }) => {
        const call = async (path: string, body: unknown) => {
          const r = await fetch(`/api/companies/${companyId}${path}`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': csrf,
            },
            body: JSON.stringify(body),
          });
          if (!r.ok) throw new Error(await r.text());
          return r.json() as Promise<{ id: string }>;
        };
        const config = await call('/statutory-configurations', {
          version: 'BROWSER-TEST-2025',
          effectiveFrom: '2025-01-01',
          effectiveTo: '2025-12-31',
          parameters: {
            schemaVersion: 'ZAMBIA-MONTHLY-1',
            componentTreatments: {
              BASE_SALARY: {
                paye: 'taxable',
                napsa: 'included',
                nhima: 'included',
              },
            },
            paye: {
              bands: [
                { upTo: '5100.00', ratePercent: '0' },
                { upTo: '7100.00', ratePercent: '20' },
                { upTo: '9200.00', ratePercent: '30' },
                { upTo: null, ratePercent: '37' },
              ],
            },
            napsa: {
              employeeRatePercent: '5',
              employerRatePercent: '5',
              employeeMonthlyCap: '1708.20',
              employerMonthlyCap: '1708.20',
            },
            nhima: {
              employeeRatePercent: '1',
              employerRatePercent: '1',
              employeeMonthlyCap: null,
              employerMonthlyCap: null,
            },
          },
          sources: ['zra', 'napsa', 'nhima'].map((authority) => ({
            authority,
            title: 'Synthetic test evidence',
            uri:
              authority === 'zra'
                ? 'https://www.zra.org.zm/'
                : `https://www.${authority}.co.zm/`,
            accessedOn: '2025-01-01',
          })),
        });
        await call(`/statutory-configurations/${config.id}/verify`, {
          expectedRowVersion: 1,
          evidenceAttestation: true,
        });
      },
      { companyId, csrf: session.csrfToken },
    );
    await nav('Settings');
    await page.getByLabel('Employer TPIN', { exact: true }).fill('1000000000');
    await page.getByLabel('NAPSA employer number').fill('TEST-EMPLOYER');
    await page.getByLabel('NHIMA employer number').fill('TEST-EMPLOYER');
    await page.getByRole('button', { name: 'Save payroll settings' }).click();
    await expect(page.getByLabel('Employer TPIN', { exact: true })).toHaveValue(
      '1000000000',
    );
    await nav('People');
    await page
      .getByRole('button', { name: 'Add employee', exact: true })
      .click();
    for (const [label, value] of [
      ['Employee number', 'TEST-001'],
      ['First name', 'Chipo'],
      ['Last name', 'Banda'],
      ['Job title', 'Accountant'],
      ['Employment start', '2025-01-01'],
    ])
      await page.getByLabel(label!, { exact: true }).fill(value!);
    await page.getByRole('button', { name: 'Save employee' }).click();
    await expect(
      page.getByRole('heading', { name: 'Chipo Banda' }),
    ).toBeVisible();
    await page.getByLabel('First name').fill('Chipo Jane');
    await page
      .getByRole('button', { name: 'Save changes', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Chipo Jane Banda' }),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Compensation', exact: true }).click();
    await page
      .getByLabel('Monthly basic pay (ZMW)', { exact: true })
      .fill('15000.00');
    await page
      .getByRole('button', { name: 'Save salary', exact: true })
      .click();
    await expect(
      page.getByRole('cell', { name: 'ZMW 15,000.00', exact: true }),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Tax & banking' }).click();
    const statutory = page.locator('section').filter({
      has: page.getByRole('heading', {
        name: 'Tax & statutory identifiers',
        exact: true,
      }),
    });
    await statutory.getByLabel('Employee TPIN').fill('1000000001');
    await statutory
      .getByLabel('NAPSA number', { exact: true })
      .fill('TEST-NAPSA');
    await statutory
      .getByLabel('NHIMA number', { exact: true })
      .fill('TEST-NHIMA');
    await statutory.getByRole('button', { name: 'Save details' }).click();
    await expect(statutory.getByLabel('Employee TPIN')).toHaveValue(
      '1000000001',
    );
    const banking = page.locator('section').filter({
      has: page.getByRole('heading', {
        name: 'Banking instructions',
        exact: true,
      }),
    });
    await banking.getByLabel('Bank name').fill('Test Bank');
    await banking.getByLabel('Account holder').fill('Chipo Jane Banda');
    await banking
      .getByLabel('Account number', { exact: true })
      .fill('0012345678');
    await banking.getByRole('button', { name: 'Save details' }).click();
    await page.getByRole('button', { name: '← Employee directory' }).click();
    await page.getByLabel('Search employees').fill('Chipo Jane');
    await expect(
      page.getByRole('button', { name: /Chipo Jane Banda/ }),
    ).toBeVisible();
    await page.getByLabel('Search employees').fill('Missing');
    await expect(
      page.getByText(
        'No employees match this search. Change the name or filters.',
      ),
    ).toBeVisible();
    await nav('Payroll periods');
    for (const [label, value] of [
      ['Period code', 'JAN-2025'],
      ['Start date', '2025-01-01'],
      ['End date', '2025-01-31'],
      ['Payment date', '2025-01-31'],
    ])
      await page.getByLabel(label!, { exact: true }).fill(value!);
    await page.getByLabel('Period type').selectOption('regular');
    await page.getByRole('button', { name: 'Save pay period' }).click();
    await expect(
      page.getByRole('cell', { name: 'JAN-2025', exact: true }),
    ).toBeVisible();
    await nav('Payroll');
    await page
      .getByRole('button', { name: 'Prepare payroll', exact: true })
      .click();
    await page
      .getByLabel('Payroll period', { exact: true })
      .selectOption({ label: 'JAN-2025 · 2025-01-01 to 2025-01-31' });
    await page
      .getByLabel('Verified statutory rules')
      .selectOption({ label: 'BROWSER-TEST-2025 · from 2025-01-01' });
    await page.getByRole('checkbox', { name: /Chipo Jane Banda/ }).check();
    await page
      .getByRole('button', { name: 'Create draft · 1 employees' })
      .click();
    await page
      .getByRole('button', { name: 'Calculate payroll', exact: true })
      .click();
    await expect(
      page.getByRole('cell', { name: 'ZMW 10,924.00', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Breakdown', exact: true }).click();
    await expect(
      page.getByRole('cell', { name: 'NAPSA-EMPLOYER', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('checkbox', {
        name: 'I have reviewed this payroll and its statutory deductions.',
      })
      .check();
    await page
      .getByRole('button', { name: 'Finalize payroll', exact: true })
      .click();
    await expect(page.getByText(/Payroll finalized/)).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Download payslips', exact: true })
      .click();
    const downloaded = await downloadPromise;
    await downloaded.saveAs(testInfo.outputPath('payslips.pdf'));
    const path = await downloaded.path();
    expect((await readFile(path!)).subarray(0, 5).toString()).toBe('%PDF-');
    await page.screenshot({
      path: testInfo.outputPath('payroll-desktop.png'),
      fullPage: true,
    });
    await nav('Reports');
    await expect(
      page.getByRole('heading', { name: 'Available documents · JAN-2025' }),
    ).toBeVisible();
    await expect(
      page.getByRole('cell', { name: 'ZMW 10,924.00', exact: true }),
    ).toBeVisible();
    await nav('ZRA returns');
    const zraRow = page.getByRole('row').filter({
      has: page.getByRole('cell', { name: 'ZRA · PAYE', exact: true }),
    });
    const csvDownload = page.waitForEvent('download');
    await zraRow.getByRole('button', { name: 'Generate schedule' }).click();
    await csvDownload;
    await expect(zraRow.getByText('generated', { exact: true })).toBeVisible();
    await page
      .getByLabel('External status', { exact: true })
      .selectOption('submitted');
    await page.getByLabel('External reference number').fill('TEST-PORTAL-REF');
    await page
      .getByRole('checkbox', {
        name: 'I confirm this status matches the external portal or authority response.',
      })
      .check();
    await page.getByRole('button', { name: 'Save filing record' }).click();
    await expect(zraRow.getByText('submitted', { exact: true })).toBeVisible();
    await nav('Overview');
    await expect(
      page.getByText('ZMW 10,924.00', { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('overview-desktop.png'),
      fullPage: true,
    });
    for (const name of [
      'Gratuity',
      'Compliance',
      'Bank batches',
      'Statutory rules',
      'Settings',
    ]) {
      await nav(name);
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await nav('People');
    await expect(
      page.getByRole('button', { name: /Chipo Jane Banda/ }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('people-mobile.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }),
    ).toHaveCount(0);
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole('navigation', { name: 'Main navigation' }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    if (companyId) await cleanUpCompany(companyId, userId);
  }
});

async function cleanUpCompany(companyId: string, userId: string) {
  const pool = new Pool({
    connectionString: process.env['TEST_DATABASE_MIGRATION_URL'],
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const table of [
      'payroll_filing_events',
      'payroll_run_components',
      'payroll_run_employees',
      'payroll_runs',
      'employee_payroll_details',
      'company_payroll_settings',
      'compensation_components',
      'salaries',
      'employments',
      'employees',
      'payroll_periods',
      'statutory_sources',
      'statutory_configurations',
      'audit_events',
      'role_permissions',
      'membership_roles',
      'company_memberships',
      'roles',
    ])
      await client.query(`DELETE FROM app.${table} WHERE company_id=$1`, [
        companyId,
      ]);
    await client.query(
      'DELETE FROM app.audit_events WHERE actor_user_account_id=$1',
      [userId],
    );
    for (const table of ['sessions', 'password_credentials'])
      await client.query(`DELETE FROM app.${table} WHERE user_account_id=$1`, [
        userId,
      ]);
    await client.query('DELETE FROM app.companies WHERE id=$1', [companyId]);
    await client.query('DELETE FROM app.user_accounts WHERE id=$1', [userId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}
