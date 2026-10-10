export type AiGlobalToggleIntent = 'confirm-disable' | 'enable';

export function getAiGlobalToggleIntent(
  currentlyEnabled: boolean
): AiGlobalToggleIntent {
  return currentlyEnabled ? 'confirm-disable' : 'enable';
}
