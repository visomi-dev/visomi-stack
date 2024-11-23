type Options = {
  length?: number;
  specials?: boolean;
  lowercase?: boolean;
  uppercase?: boolean;
  numbers?: boolean;
};

const specials = '^$*.[]{}()?-"!@#%&/\\,><\':;|_~`+=';
const lowercase = 'abcdefghijklmnopqrstuvwxyz';
const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const numbers = '0123456789';

function pick(str: string, min: number, max?: number): string {
  let n = min;
  let chars = '';

  if (max != null) {
    n = Math.floor(Math.random() * (max - min + 1)) + min;
  }

  for (let i = 0; i < n; i++) {
    chars += str.charAt(Math.floor(Math.random() * str.length));
  }

  return chars;
}

function shuffle(str: string): string {
  const items = str.split('');

  let tmp = '';
  let current = 0;
  let top = items.length;

  while (top > 0) {
    current = Math.floor(Math.random() * top);

    top -= 1;

    tmp = items[current];
    items[current] = items[top];
    items[top] = tmp;
  }

  return items.join('');
}

export function generatePassword({
  length = 16,
  specials: needsSpecials = true,
  lowercase: needsLowercase = true,
  uppercase: needsUppercase = true,
  numbers: needsNumbers = true,
}: Options): string {
  const specialsChars = needsSpecials ? pick(specials, 1) : '';
  const lowercaseChars = needsLowercase ? pick(lowercase, 1) : '';
  const uppercaseChars = needsUppercase ? pick(uppercase, 1) : '';
  const numbersChars = needsNumbers ? pick(numbers, 1) : '';
  const baseChars = needsSpecials
    ? `${lowercase}${uppercase}${numbers}${specials}`
    : `${lowercase}${uppercase}${numbers}`;

  const restChars = pick(baseChars, length - (needsSpecials ? 4 : 3));

  return shuffle(
    `${specialsChars}${lowercaseChars}${uppercaseChars}${numbersChars}${restChars}`,
  );
}

export function generateCode(length = 6, alphanumeric = false): string {
  const options = alphanumeric ? `${uppercase}${numbers}` : numbers;

  const code = pick(options, length);

  return shuffle(code);
}
