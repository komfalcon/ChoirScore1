import {
  DEFAULT_VOICE_RANGES,
  voiceRangesSchema,
  type VoicePartRanges,
} from '@choirscore/shared';
import type { ApiRepository } from '../db/repository';

/** Read only the canonical, validated persisted profile (or the safe defaults). */
export async function readVoiceRanges(
  repository: Pick<ApiRepository, 'getSetting'>
): Promise<VoicePartRanges> {
  const stored = await repository.getSetting('voice_ranges_json');
  if (stored === null) return DEFAULT_VOICE_RANGES;
  return voiceRangesSchema.parse(JSON.parse(stored) as unknown);
}
