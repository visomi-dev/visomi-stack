import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Session } from '../session/session';

import { BackupDisplay } from './backup-display';

it('binds the download link and revokes each Blob URL when codes change or the view is destroyed', async () => {
  const create = vi.fn().mockReturnValueOnce('blob:synthetic-first').mockReturnValueOnce('blob:synthetic-second');
  const revoke = vi.fn();

  vi.stubGlobal(
    'URL',
    class extends URL {
      static override createObjectURL = create;
      static override revokeObjectURL = revoke;
    },
  );

  TestBed.configureTestingModule({
    providers: [provideRouter([]), { provide: Session, useValue: { full: () => true } }],
  });
  const fixture = TestBed.createComponent(BackupDisplay);

  try {
    fixture.componentRef.setInput('codes', ['synthetic-first']);

    await fixture.whenStable();

    const anchor = (fixture.nativeElement as HTMLElement).querySelector('a')!;

    expect(anchor.getAttribute('href')).toBe('blob:synthetic-first');
    expect(anchor.download).toBe('visomi-backup-codes.txt');
    fixture.componentRef.setInput('codes', ['synthetic-second']);

    await fixture.whenStable();

    expect(revoke).toHaveBeenCalledWith('blob:synthetic-first');
    expect(anchor.getAttribute('href')).toBe('blob:synthetic-second');
  } finally {
    fixture.destroy();
    vi.unstubAllGlobals();
  }

  expect(revoke).toHaveBeenCalledWith('blob:synthetic-second');
});
