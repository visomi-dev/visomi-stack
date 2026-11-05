import { TestBed } from '@angular/core/testing';

import { QrCode } from './qr-code';

const { draw } = vi.hoisted(() => ({ draw: vi.fn() }));

vi.mock('qrcode', () => ({ default: { toCanvas: draw } }));

beforeEach(() => draw.mockReset().mockResolvedValue(undefined));

it('regenerates the local QR when its URI changes', async () => {
  const fixture = TestBed.createComponent(QrCode);

  fixture.componentRef.setInput('uri', 'otpauth://totp/Synthetic?secret=SYNTHETICONE');

  await fixture.whenStable();

  await vi.waitFor(() => expect(draw).toHaveBeenCalledTimes(1));

  fixture.componentRef.setInput('uri', 'otpauth://totp/Synthetic?secret=SYNTHETICTWO');

  await fixture.whenStable();

  await vi.waitFor(() => expect(draw).toHaveBeenCalledTimes(2));

  expect(draw.mock.calls.map((call) => call[1])).toEqual([
    'otpauth://totp/Synthetic?secret=SYNTHETICONE',
    'otpauth://totp/Synthetic?secret=SYNTHETICTWO',
  ]);
});

it('ignores an old render failure after the URI changes', async () => {
  let rejectOld: (error: Error) => void = () => undefined;

  draw.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectOld = reject;
      }),
  );
  const fixture = TestBed.createComponent(QrCode);

  fixture.componentRef.setInput('uri', 'otpauth://totp/Synthetic?secret=SYNTHETICONE');

  await fixture.whenStable();

  await vi.waitFor(() => expect(draw).toHaveBeenCalledTimes(1));

  fixture.componentRef.setInput('uri', 'otpauth://totp/Synthetic?secret=SYNTHETICTWO');

  await fixture.whenStable();

  await vi.waitFor(() => expect(draw).toHaveBeenCalledTimes(2));

  rejectOld(new Error('synthetic-obsolete-render'));

  await fixture.whenStable();

  expect(fixture.componentInstance.failed()).toBe(false);
});

it('does not draw after the view is destroyed while loading the library', async () => {
  const fixture = TestBed.createComponent(QrCode);

  fixture.componentRef.setInput('uri', 'otpauth://totp/Synthetic?secret=SYNTHETIC');
  fixture.detectChanges();
  fixture.destroy();

  await vi.dynamicImportSettled();

  expect(draw).not.toHaveBeenCalled();
});
