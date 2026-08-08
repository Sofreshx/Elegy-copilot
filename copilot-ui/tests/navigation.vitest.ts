import { describe, expect, it } from 'vitest';

import { SIDEBAR_NAV_ITEMS } from '../ui/src/stores/navigation';

describe('sidebar navigation', () => {
  it('presents Opportunity Intelligence at the stable world-model route', () => {
    expect(SIDEBAR_NAV_ITEMS).toContainEqual(expect.objectContaining({
      id: 'world-model',
      label: 'Opportunity Intelligence',
    }));
  });
});
