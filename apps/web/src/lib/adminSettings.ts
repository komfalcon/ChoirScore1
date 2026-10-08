import type {
  GetAdminSettingsResponse,
  PatchAdminSettingsRequest,
  PatchAdminSettingsResponse,
} from '@choirscore/shared';
import { apiJson, jsonRequest } from './api';

export function getAdminSettings() {
  return apiJson<GetAdminSettingsResponse>('/admin/settings');
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
