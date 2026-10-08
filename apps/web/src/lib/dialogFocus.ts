export function focusTrapBoundaryIndex(
  activeIndex: number,
  focusableCount: number,
  shiftKey: boolean
): number | null {
  if (focusableCount <= 0) return null;
  if (shiftKey && activeIndex <= 0) return focusableCount - 1;
  if (!shiftKey && (activeIndex < 0 || activeIndex >= focusableCount - 1))
    return 0;
  return null;
}
