import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/garmin/store';
import { formatLaps, getActivityLapsTool } from '../src/tools/get-activity-laps';
import { formatActivity } from '../src/tools/get-activity';
import { buildZip, syntheticRunFit } from './fit-builder';
import { NOW_MS, expectNoPrivateFields, fixture, json, toolSetup } from './helpers';

const DOWNLOAD = '/download-service/files/activity/';
const ID = 1000000001;

async function download(): Promise<Response> {
  const zip = await buildZip([{ name: `${ID}_ACTIVITY.fit`, bytes: syntheticRunFit() }]);
  return new Response(zip, { headers: { 'content-type': 'application/zip' } });
}

describe('garmin_get_activity_laps', () => {
  it('returns laps and interval reps in metric units', async () => {
    const { context } = toolSetup({ [DOWNLOAD]: download });
    const result = await getActivityLapsTool.run({ activity_id: ID }, context);

    expect(result).toMatchObject({ activity_id: ID, sport: 'running', lap_count: 2 });
    expect(result.laps[0]).toMatchObject({
      lap: 1,
      intensity: 'active',
      trigger: 'distance',
      start_elapsed_s: 0,
      distance_km: 1,
      duration: '5:00',
      avg_pace_min_per_km: '5:00',
      avg_hr_bpm: 150,
      max_hr_bpm: 158,
      avg_power_w: 300,
      avg_cadence_spm: 171,
      stride_length_cm: 120,
    });
    expect(result.laps[1]).toMatchObject({
      lap: 2,
      start_elapsed_s: 300,
      avg_pace_min_per_km: '4:00',
    });
  });

  it('lists interval reps in time order, without run / walk splits', async () => {
    const { context } = toolSetup({ [DOWNLOAD]: download });
    const { intervals } = await getActivityLapsTool.run({ activity_id: ID }, context);

    expect(intervals?.map((rep) => rep.type)).toEqual(['warmup', 'active', 'recovery']);
    expect(intervals?.[1]).toMatchObject({
      start_elapsed_s: 300,
      distance_km: 0.5,
      duration: '2:00',
      avg_cadence_spm: 180,
    });
  });

  it('never returns location or owner fields', async () => {
    const { context } = toolSetup({ [DOWNLOAD]: download });
    expectNoPrivateFields(await getActivityLapsTool.run({ activity_id: ID }, context));
  });

  it('reads the FIT file once and then uses the cache', async () => {
    const { context, paths } = toolSetup({ [DOWNLOAD]: download });
    const first = await getActivityLapsTool.run({ activity_id: ID }, context);
    const second = await getActivityLapsTool.run({ activity_id: ID }, context);

    expect(second).toEqual(first);
    expect(paths().filter((path) => path.startsWith(DOWNLOAD))).toHaveLength(1);
  });

  it('reads the file again after a corrupt cache entry', async () => {
    const store = new MemoryStore(() => NOW_MS);
    await store.put(`garmin:laps:v1:${ID}`, 'not json');
    const { context } = toolSetup({ [DOWNLOAD]: download }, { store });
    const result = await getActivityLapsTool.run({ activity_id: ID }, context);
    expect(result.lap_count).toBe(2);
  });

  it('still answers when the cache can not be written', async () => {
    const store = new MemoryStore(() => NOW_MS);
    const { context } = toolSetup({ [DOWNLOAD]: download }, { store });
    const failing = {
      ...context,
      store: { get: store.get.bind(store), put: () => Promise.reject(new Error('KV limit')) },
    };
    const result = await getActivityLapsTool.run({ activity_id: ID }, failing);
    expect(result.lap_count).toBe(2);
  });

  it('reports an activity without a file', async () => {
    const { context } = toolSetup({ [DOWNLOAD]: () => json({ message: 'not found' }, 404) });
    await expect(getActivityLapsTool.run({ activity_id: ID }, context)).rejects.toThrow(
      /activity 1000000001/,
    );
  });
});

describe('formatLaps', () => {
  const lap = { startTime: 10, timerTime: 600, distance: 3000, avgSpeed: 5, avgCadence: 80 };

  it('says so when an activity has no laps', () => {
    const result = formatLaps(1, { sessions: [{ sport: 10 }], laps: [], splits: [] });
    expect(result.lap_count).toBe(0);
    expect(result.note).toContain('no laps');
  });

  it('uses speed and rpm for cycling', () => {
    const [row] = formatLaps(1, { sessions: [{ sport: 2 }], laps: [lap], splits: [] }).laps;
    expect(row).toMatchObject({ avg_speed_kmh: 18, avg_cadence_rpm: 80 });
    expect(row).not.toHaveProperty('avg_cadence_spm');
  });

  it('uses pace per 100 m for swimming', () => {
    const [row] = formatLaps(1, { sessions: [{ sport: 5 }], laps: [lap], splits: [] }).laps;
    expect(row).toHaveProperty('avg_pace_min_per_100m');
    expect(row).not.toHaveProperty('avg_cadence_spm');
  });

  it('leaves out an interval list of one, which is the whole activity', () => {
    const split = { type: 3, startTime: 10, timerTime: 600, distance: 3000 };
    const sessions = [{ sport: 1 }];
    expect(formatLaps(1, { sessions, laps: [lap], splits: [split] }).intervals).toBeNull();
  });
});

describe('garmin_get_activity lap note', () => {
  it('points to the laps tool', () => {
    const detail = fixture('activity.json') as Parameters<typeof formatActivity>[0];
    const withLaps = { ...detail, metadataDTO: { ...detail.metadataDTO, lapCount: 5 } };
    expect(formatActivity(withLaps, undefined).note).toContain('garmin_get_activity_laps');
  });
});
