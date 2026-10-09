import { Router } from 'express';
import type { ApiRepository } from '../../db/repository';
import { readVoiceRanges } from '../../services/voiceRanges';

/** Authentication and active-user enforcement are applied by the app globally. */
export function createSettingsRouter(repository: ApiRepository) {
  const router = Router();

  router.get('/voice-ranges', async (_req, res) => {
    const profile = await readVoiceRanges(repository);
    return res.status(200).json(profile);
  });

  return router;
}
