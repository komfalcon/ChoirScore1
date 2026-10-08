import { describe, expect, it } from 'vitest';
import {
  normalizeUsername,
  parseBulkNameImport,
  suggestBulkUsernames,
  suggestUsernameFromName,
  truncateUtf8Bytes,
  utf8ByteLength,
  validateBulkUserDrafts,
  validatePasswordOverride,
  validateUserIdentity,
} from './userValidation';

describe('user form validation', () => {
  it('requires a voice part for members but not leadership roles', () => {
    expect(
      validateUserIdentity(
        { displayName: 'Sam', username: '', role: 'member', voicePart: '' },
        false
      )
    ).toMatch(/voice part/i);
    expect(
      validateUserIdentity(
        {
          displayName: 'Morgan',
          username: '',
          role: 'director',
          voicePart: 'none',
        },
        false
      )
    ).toBe('');
    expect(
      validateUserIdentity(
        {
          displayName: 'Riley',
          username: '',
          role: 'admin',
          voicePart: 'none',
        },
        false
      )
    ).toBe('');
  });

  it('accepts a blank or eight-character password override and rejects shorter values', () => {
    expect(validatePasswordOverride('')).toBe('');
    expect(validatePasswordOverride('1234567')).toMatch(/at least 8/i);
    expect(validatePasswordOverride('12345678')).toBe('');
  });

  it('measures the maximum password size in UTF-8 bytes', () => {
    expect(validatePasswordOverride('a'.repeat(72))).toBe('');
    expect(validatePasswordOverride('a'.repeat(73))).toMatch(/72 UTF-8 bytes/i);
    expect(validatePasswordOverride('😀'.repeat(18))).toBe('');
    expect(validatePasswordOverride('😀'.repeat(19))).toMatch(
      /72 UTF-8 bytes/i
    );
  });

  it('truncates password input only at complete Unicode code points', () => {
    const truncated = truncateUtf8Bytes(`${'a'.repeat(68)}😀x`, 72);
    expect(truncated).toBe(`${'a'.repeat(68)}😀`);
    expect(utf8ByteLength(truncated)).toBe(72);
  });

  it('suggests a visible, editable username and avoids known collisions', () => {
    expect(suggestUsernameFromName('Kōfi Mensah')).toBe('kofi.mensah');
    expect(suggestUsernameFromName('Kōfi Mensah', ['KOFI.MENSAH'])).toBe(
      'kofi.mensah.2'
    );
  });

  it('reserves normalized candidates across sibling rows in one batch', () => {
    const suggestions = suggestBulkUsernames([
      {
        rowId: 1,
        displayName: 'Kōfi Mensah',
        username: '',
        usernameAuto: true,
      },
      {
        rowId: 2,
        displayName: 'Kofi Mensah',
        username: '',
        usernameAuto: true,
      },
    ]);

    expect(suggestions).toEqual({
      1: 'kofi.mensah',
      2: 'kofi.mensah.2',
    });
    expect(normalizeUsername('  KOFI.MENSAH  ')).toBe('kofi.mensah');
  });

  it('reserves an account username even when the current search hides that account', () => {
    const allAccounts = [
      { displayName: 'Lina Hidden', username: 'lina.hidden' },
    ];
    const currentlyVisible = allAccounts.filter((account) =>
      `${account.displayName} ${account.username}`
        .toLocaleLowerCase('en-US')
        .includes('another person')
    );
    expect(currentlyVisible).toEqual([]);

    expect(
      suggestBulkUsernames(
        [
          {
            rowId: 7,
            displayName: 'Lina Hidden',
            username: '',
            usernameAuto: true,
          },
        ],
        allAccounts.map((account) => account.username)
      )
    ).toEqual({ 7: 'lina.hidden.2' });

    const validation = validateBulkUserDrafts(
      [
        {
          rowId: 7,
          displayName: 'Lina Hidden',
          username: 'LINA.HIDDEN',
          role: 'director',
          voicePart: 'none',
        },
      ],
      allAccounts.map((account) => account.username)
    );
    expect(validation.errors[7]).toMatch(/already in use/i);
  });

  it('rejects bulk member rows without a voice part, short overrides, and duplicate usernames before submit', () => {
    const result = validateBulkUserDrafts([
      {
        rowId: 1,
        displayName: 'Alto One',
        username: 'shared.name',
        role: 'member',
        voicePart: '',
        password: 'short',
      },
      {
        rowId: 2,
        displayName: 'Alto Two',
        username: 'SHARED.NAME',
        role: 'member',
        voicePart: 'A',
      },
    ]);
    expect(result.errors[1]).toMatch(/voice part/i);
    expect(result.errors[1]).toMatch(/at least 8/i);
    expect(result.errors[2]).toMatch(/repeated/i);
    expect(result.message).toMatch(/before submitting/i);
  });

  it('accepts valid all-or-nothing bulk rows', () => {
    expect(
      validateBulkUserDrafts([
        {
          rowId: 1,
          displayName: 'Soprano One',
          username: '',
          role: 'member',
          voicePart: 'S',
        },
        {
          rowId: 2,
          displayName: 'Choir Director',
          username: '',
          role: 'director',
          voicePart: 'none',
        },
      ])
    ).toEqual({ errors: {}, message: '' });
  });

  it('imports one name per line with optional letter or full-name voice part', () => {
    expect(
      parseBulkNameImport('Ada Lovelace, S\nKofi Mensah, tenor\nNo Voice Yet')
    ).toEqual({
      rows: [
        {
          displayName: 'Ada Lovelace',
          username: '',
          role: 'member',
          voicePart: 'S',
          password: '',
        },
        {
          displayName: 'Kofi Mensah',
          username: '',
          role: 'member',
          voicePart: 'T',
          password: '',
        },
        {
          displayName: 'No Voice Yet',
          username: '',
          role: 'member',
          voicePart: '',
          password: '',
        },
      ],
      errors: [],
    });
  });

  it('supports CSV headers/quoted names and reports invalid voice parts without silently importing partial rows', () => {
    const result = parseBulkNameImport(
      'Name,Voice Part\n"Ada, Rae", A\nSam, X'
    );
    expect(result.rows).toEqual([
      {
        displayName: 'Ada, Rae',
        username: '',
        role: 'member',
        voicePart: 'A',
        password: '',
      },
    ]);
    expect(result.errors).toEqual([
      'Line 3: voice part must be S, A, T, or B (or its full name).',
    ]);
  });

  it('skips a BOM-prefixed CSV header', () => {
    const result = parseBulkNameImport(
      '\uFEFFDisplay_Name,VoicePart\nAda Lovelace,S'
    );
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      displayName: 'Ada Lovelace',
      voicePart: 'S',
    });
  });
});
