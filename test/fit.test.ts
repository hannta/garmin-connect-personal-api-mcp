import { describe, expect, it } from 'vitest';
import { GarminError } from '../src/garmin/errors';
import { parseFit, readActivityFile, unzipFit } from '../src/garmin/fit';
import {
  FitBuilder,
  SINT32,
  UINT16,
  UINT32,
  UINT8,
  buildZip,
  syntheticRunFit,
} from './fit-builder';

const LAP = 19;

describe('parseFit', () => {
  it('reads laps, splits and sessions and steps over records', () => {
    const fit = parseFit(syntheticRunFit());
    expect(fit.sessions).toEqual([{ sport: 1 }]);
    expect(fit.laps).toHaveLength(2);
    expect(fit.laps[0]).toMatchObject({
      timerTime: 300,
      distance: 1000,
      avgHeartRate: 150,
      avgCadence: 85,
      avgFractionalCadence: 0.5,
      stepLength: 1200,
      trigger: 2,
    });
    expect(fit.splits.map((split) => split.type)).toEqual([3, 5, 7, 17]);
    expect(fit.splits[0]).toMatchObject({ avgCadence: 90, distance: 500, avgSpeed: 4.167 });
  });

  it('never reads position fields', () => {
    const output = JSON.stringify(parseFit(syntheticRunFit()));
    expect(output).not.toMatch(/position|lat|long/i);
  });

  it('drops FIT invalid values', () => {
    const fields = [
      [15, UINT8],
      [19, UINT16],
      [9, UINT32],
    ] as const;
    const bytes = new FitBuilder()
      .define(0, LAP, fields)
      .data(0, fields, [0xff, 0xffff, 0xffffffff])
      .build();
    expect(parseFit(bytes).laps).toEqual([{}]);
  });

  it('reads big-endian messages', () => {
    const fields = [[9, UINT32]] as const;
    const bytes = new FitBuilder()
      .define(0, LAP, fields, { littleEndian: false })
      .data(0, fields, [150_000], { littleEndian: false })
      .build();
    expect(parseFit(bytes).laps).toEqual([{ distance: 1500 }]);
  });

  it('skips developer fields, unknown fields and arrays by their size', () => {
    // Field 19 is listed as a scalar; here it's an array of two uint16 values.
    const fields = [
      [9, UINT32],
      [200, SINT32],
      [19, [0x84, 4]],
      [15, UINT8],
    ] as const;
    const payload = [
      [9, UINT32],
      [200, SINT32],
      [0, UINT16],
      [0, UINT16],
      [15, UINT8],
    ] as const;
    const complete = new FitBuilder()
      .define(0, LAP, fields, { developerFieldSizes: [2, 4] })
      .data(0, payload, [100_000, 1, 300, 310, 150], { extra: 6 })
      .define(1, LAP, [[15, UINT8]])
      .data(1, [[15, UINT8]], [99]);
    expect(parseFit(complete.build()).laps).toEqual([
      { distance: 1000, avgHeartRate: 150 },
      { avgHeartRate: 99 },
    ]);
  });

  it('reads chained FIT files', () => {
    const one = syntheticRunFit();
    const chained = new Uint8Array(one.length * 2);
    chained.set(one);
    chained.set(one, one.length);
    expect(parseFit(chained).laps).toHaveLength(4);
  });

  it('rejects data that is not FIT', () => {
    expect(() => parseFit(new TextEncoder().encode('not a fit file at all'))).toThrow();
  });

  it('rejects a data message without a definition', () => {
    const fields = [[15, UINT8]] as const;
    const bytes = new FitBuilder().data(0, fields, [1]).build();
    expect(() => parseFit(bytes)).toThrow();
  });
});

describe('unzipFit', () => {
  const fit = syntheticRunFit();

  it('inflates a deflated file', async () => {
    expect(await unzipFit(await buildZip([{ name: '1_ACTIVITY.fit', bytes: fit }]))).toEqual(fit);
  });

  it('reads a stored file and skips other files', async () => {
    const zip = await buildZip([
      { name: 'readme.txt', bytes: new Uint8Array(5) },
      { name: '1_ACTIVITY.FIT', bytes: fit, method: 0 },
    ]);
    expect(await unzipFit(zip)).toEqual(fit);
  });

  it('reports a ZIP without a FIT file', async () => {
    const zip = await buildZip([{ name: 'activity.gpx', bytes: new Uint8Array(5) }]);
    await expect(readActivityFile(zip, 'activity 1')).rejects.toThrow(/no FIT data/);
  });
});

describe('readActivityFile', () => {
  it('reads an activity download', async () => {
    const zip = await buildZip([{ name: '1_ACTIVITY.fit', bytes: syntheticRunFit() }]);
    expect((await readActivityFile(zip, 'activity 1')).laps).toHaveLength(2);
  });

  it('turns unreadable files into a safe GarminError', async () => {
    const error = await readActivityFile(new Uint8Array(40), 'activity 1').catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(GarminError);
    expect((error as GarminError).message).toBe('Could not read the Garmin file for activity 1.');
  });

  it('reports a truncated FIT file', async () => {
    const zip = await buildZip([
      { name: '1_ACTIVITY.fit', bytes: syntheticRunFit().subarray(0, 60), method: 0 },
    ]);
    await expect(readActivityFile(zip, 'activity 1')).rejects.toBeInstanceOf(GarminError);
  });
});
