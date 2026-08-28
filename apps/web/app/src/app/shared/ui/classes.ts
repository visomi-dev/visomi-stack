export type ClassValue = false | null | string | undefined;

export function uiClass(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
