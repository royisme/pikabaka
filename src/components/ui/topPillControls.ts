export function shouldShowTopPillRunControls(expanded: boolean, hasRunControls: boolean): boolean {
  return !expanded && hasRunControls;
}
