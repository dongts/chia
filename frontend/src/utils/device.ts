/**
 * True on devices with a precise pointer (mouse/trackpad). On touch screens,
 * programmatically focusing an input pops up the on-screen keyboard, which
 * covers dropdown options — so only auto-focus search fields when this is true.
 */
export function hasFinePointer(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(pointer: fine)").matches;
}
