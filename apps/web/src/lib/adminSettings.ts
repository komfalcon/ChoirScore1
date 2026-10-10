import type {
  GetAdminAiUsageResponse,
  GetAdminSettingsResponse,
  PatchAdminSettingsRequest,
  PatchAdminSettingsResponse,
  VoicePartRanges,
} from '@choirscore/shared';
import { apiJson, jsonRequest } from './api';

export function getAdminSettings() {
  return apiJson<GetAdminSettingsResponse>('/admin/settings');
}

export function getAdminAiUsage() {
  return apiJson<GetAdminAiUsageResponse>('/admin/usage');
}

export function updateAiGlobalEnabled(aiGlobalEnabled: boolean) {
  const request: PatchAdminSettingsRequest = { aiGlobalEnabled };
  return apiJson<PatchAdminSettingsResponse>(
    '/admin/settings',
    jsonRequest('PATCH', request)
  );
}

export function updateFirstLoginPasswordSetting(
  requirePasswordChangeAtFirstLogin: boolean
) {
  const request: PatchAdminSettingsRequest = {
    requirePasswordChangeAtFirstLogin,
  };
  return apiJson<PatchAdminSettingsResponse>(
    '/admin/settings',
    jsonRequest('PATCH', request)
  );
}

export function updateVoiceRangesSetting(voiceRanges: VoicePartRanges) {
  const request: PatchAdminSettingsRequest = { voiceRanges };
  return apiJson<PatchAdminSettingsResponse>(
    '/admin/settings',
    jsonRequest('PATCH', request)
  );
}
