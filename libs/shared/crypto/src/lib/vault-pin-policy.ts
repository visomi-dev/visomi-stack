export function isVaultPinValid(pin: string): boolean {
  if (!/^[0-9]{6}$/.test(pin) || /^([0-9])\1{5}$/.test(pin)) return false;
  const digits = [...pin].map(Number);
  const ascending = digits.every((digit, index) => index === 0 || digit === (digits[index - 1] + 1) % 10);
  const descending = digits.every((digit, index) => index === 0 || digit === (digits[index - 1] + 9) % 10);

  return !ascending && !descending;
}
