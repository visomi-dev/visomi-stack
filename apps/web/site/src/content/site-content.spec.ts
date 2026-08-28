import { describe, expect, it } from 'vitest';

import { getSiteContent } from './site-content';

describe('getSiteContent', () => {
  it('returns english copy', () => {
    expect(getSiteContent('en').description).toContain('full-stack');
    expect(getSiteContent('en').description).toContain('zero-knowledge');
  });

  it('returns spanish copy', () => {
    expect(getSiteContent('es').description).toContain('full-stack');
    expect(getSiteContent('es').description).toContain('Themis');
  });
});
