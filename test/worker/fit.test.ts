import { describe, expect, it } from 'vitest';
import { readActivityFile } from '../../src/garmin/fit';
import { buildZip, syntheticRunFit } from '../fit-builder';

// The ZIP is inflated with DecompressionStream, so check it in the Workers runtime too.
describe('activity files in workerd', () => {
  it('reads a deflated FIT file', async () => {
    const zip = await buildZip([{ name: '1_ACTIVITY.fit', bytes: syntheticRunFit() }]);
    const activity = await readActivityFile(zip, 'activity 1');
    expect(activity.laps).toHaveLength(2);
  });
});
