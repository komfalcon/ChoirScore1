import { describe, expect, it } from 'vitest';
import { credentialsToCsv } from './credentialsExport';

describe('credentials CSV export', () => {
  it('quotes and escapes commas, quotes, and line breaks without changing credential values', () => {
    expect(
      credentialsToCsv([
        {
          displayName: 'Rae, "RJ" Lee',
          username: 'rae.lee',
          password: 'exact,Pass"123',
        },
        {
          displayName: 'Line\nBreak',
          username: 'line.break',
          password: 'KeepThisExactly!',
        },
      ])
    ).toBe(
      '\uFEFF"Display name","Username","Password"\r\n"Rae, ""RJ"" Lee","rae.lee","exact,Pass""123"\r\n"Line\nBreak","line.break","KeepThisExactly!"'
    );
  });

  it('returns a header-only CSV for an empty sheet', () => {
    expect(credentialsToCsv([])).toBe(
      '\uFEFF"Display name","Username","Password"'
    );
  });

  it('prefixes spreadsheet formula markers in every exported field', () => {
    const csv = credentialsToCsv([
      {
        displayName: '=SUM(1,1)',
        username: '+cmd',
        password: '-1+1',
      },
      {
        displayName: '@mention',
        username: '\t=HYPERLINK("bad")',
        password: 'ordinary-password',
      },
    ]);

    expect(csv).toContain('"\'=SUM(1,1)"');
    expect(csv).toContain('"\'+cmd"');
    expect(csv).toContain('"\'-1+1"');
    expect(csv).toContain('"\'@mention"');
    expect(csv).toContain('"\'\t=HYPERLINK(""bad"")"');
    expect(csv).toContain('"ordinary-password"');
  });
});
