export type NotationMode = 'solfa' | 'staff';

const STORAGE_KEY_PREFIX = 'choirscore:notation-mode:v1:';
const DEFAULT_NOTATION_MODE: NotationMode = 'solfa';

export function notationModeStorageKey(userId: string) {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(userId)}`;
}

export function loadNotationMode(userId: string | null): NotationMode {
  if (!userId) return DEFAULT_NOTATION_MODE;

  try {
    const savedMode = globalThis.localStorage?.getItem(
      notationModeStorageKey(userId)
    );
    return savedMode === 'staff' || savedMode === 'solfa'
      ? savedMode
      : DEFAULT_NOTATION_MODE;
  } catch {
    return DEFAULT_NOTATION_MODE;
  }
}

export function saveNotationMode(userId: string | null, mode: NotationMode) {
  if (!userId) return;

  try {
    globalThis.localStorage?.setItem(notationModeStorageKey(userId), mode);
  } catch {
    // Keep the in-memory view switch usable when browser storage is unavailable.
  }
}
