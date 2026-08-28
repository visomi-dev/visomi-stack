const fs = require('node:fs');

const RealDate = Date;
const clockFile = process.env.PASSKEY_E2E_CLOCK_FILE;
const advanceFile = process.env.PASSKEY_E2E_CLOCK_ADVANCE_FILE;

if (clockFile) {
  const step = Number(process.env.PASSKEY_E2E_CLOCK_STEP_MS ?? 0);
  const now = () => {
    const value = Number(fs.readFileSync(clockFile, 'utf8'));

    if (advanceFile && step > 0 && fs.existsSync(advanceFile)) fs.writeFileSync(clockFile, String(value + step));

    return value;
  };

  global.Date = class TestDate extends RealDate {
    constructor(...args) {
      super(...(args.length === 0 ? [now()] : args));
    }

    static now() {
      return now();
    }
  };
}
