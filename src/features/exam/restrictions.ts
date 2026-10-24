/** Best-effort page restrictions. These are deterrents, not evidence of cheating. */
export function isEditableExamTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function isBlockedExamShortcut(event: KeyboardEvent): boolean {
  if (isEditableExamTarget(event.target)) return false;
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return false;
  return event.key.toLowerCase() === 'c' || event.key.toLowerCase() === 'x';
}
