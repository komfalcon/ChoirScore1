import { voiceRangesSchema, type VoicePartRanges } from '@choirscore/shared';
import { apiFetch } from './apiClient';

export class SettingsApiResponseError extends Error {
  constructor() {
    super('The settings service returned an unexpected voice-range profile.');
    this.name = 'SettingsApiResponseError';
  }
}

/** Fetch only the member-safe canonical SATB range profile. */
export async function getVoiceRanges(
  signal?: AbortSignal
): Promise<VoicePartRanges> {
  const response = await apiFetch('/settings/voice-ranges', { signal });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SettingsApiResponseError();
  }
  try {
    return voiceRangesSchema.parse(payload);
  } catch {
    throw new SettingsApiResponseError();
  }
}
