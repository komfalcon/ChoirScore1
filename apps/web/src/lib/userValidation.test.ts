import { describe, expect, it } from 'vitest';
import {
  parseBulkNameImport,
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
