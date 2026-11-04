// Builds synthetic FIT files and ZIPs for tests; all values are made up. No Node APIs, so
// it also runs in workerd.

/** FIT base types used here: [type byte, size]. */
export const UINT8 = [0x02, 1] as const;
export const UINT16 = [0x84, 2] as const;
export const SINT32 = [0x85, 4] as const;
export const UINT32 = [0x86, 4] as const;

export type FieldDefinition = readonly [number, readonly [number, number]];

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function encode(values: number[], fields: readonly FieldDefinition[], littleEndian: boolean) {
  const size = fields.reduce((sum, [, type]) => sum + type[1], 0);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  fields.forEach(([, [, width]], index) => {
    const value = values[index] ?? 0;
    if (width === 1) view.setUint8(offset, value);
    else if (width === 2) view.setUint16(offset, value, littleEndian);
    else view.setUint32(offset, value, littleEndian);
    offset += width;
  });
  return bytes;
}

export class FitBuilder {
  readonly #records: Uint8Array[] = [];

  define(
    local: number,
    globalNumber: number,
    fields: readonly FieldDefinition[],
    options: { littleEndian?: boolean; developerFieldSizes?: number[] } = {},
  ): this {
    const littleEndian = options.littleEndian ?? true;
    const developer = options.developerFieldSizes;
    const header = 0x40 | (developer ? 0x20 : 0) | local;
    const number = new Uint8Array(2);
    new DataView(number.buffer).setUint16(0, globalNumber, littleEndian);
    this.#records.push(
      Uint8Array.of(header, 0, littleEndian ? 0 : 1, ...number, fields.length),
      ...fields.map(([field, [type, size]]) => Uint8Array.of(field, size, type)),
    );
    if (developer) {
      this.#records.push(
        Uint8Array.of(developer.length),
        ...developer.map((size, index) => Uint8Array.of(index, size, 0)),
      );
    }
    return this;
  }

  data(
    local: number,
    fields: readonly FieldDefinition[],
    values: number[],
    options: { littleEndian?: boolean; compressedTimestamp?: boolean; extra?: number } = {},
  ): this {
    const header = options.compressedTimestamp ? 0x80 | (local << 5) | 3 : local;
    this.#records.push(
      Uint8Array.of(header),
      encode(values, fields, options.littleEndian ?? true),
      new Uint8Array(options.extra ?? 0),
    );
    return this;
  }

  build(): Uint8Array {
    const data = concat(this.#records);
    const header = new Uint8Array(14);
    const view = new DataView(header.buffer);
    view.setUint8(0, 14);
    view.setUint8(1, 0x20);
    view.setUint32(4, data.length, true);
    header.set(new TextEncoder().encode('.FIT'), 8);
    return concat([header, data, new Uint8Array(2)]);
  }
}

export async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A ZIP with one file per entry; method 8 deflates, 0 stores. */
export async function buildZip(
  files: { name: string; bytes: Uint8Array; method?: 0 | 8 }[],
): Promise<Uint8Array> {
  const locals: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const method = file.method ?? 8;
    const body = method === 8 ? await deflateRaw(file.bytes) : file.bytes;
    const name = new TextEncoder().encode(file.name);

    const local = new Uint8Array(30);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, method, true);
    localView.setUint32(18, body.length, true);
    localView.setUint32(22, file.bytes.length, true);
    localView.setUint16(26, name.length, true);

    const entry = new Uint8Array(46);
    const entryView = new DataView(entry.buffer);
    entryView.setUint32(0, 0x02014b50, true);
    entryView.setUint16(10, method, true);
    entryView.setUint32(20, body.length, true);
    entryView.setUint32(24, file.bytes.length, true);
    entryView.setUint16(28, name.length, true);
    entryView.setUint32(42, offset, true);

    locals.push(local, name, body);
    directory.push(entry, name);
    offset += local.length + name.length + body.length;
  }
  const directoryBytes = concat(directory);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, directoryBytes.length, true);
  endView.setUint32(16, offset, true);
  return concat([...locals, directoryBytes, end]);
}

// Message numbers and field numbers from the FIT profile.
const SESSION = 18;
const LAP = 19;
const SPLIT = 312;
const RECORD = 20;

const SESSION_DEFINITION: FieldDefinition[] = [[5, UINT8]];
const LAP_DEFINITION: FieldDefinition[] = [
  [2, UINT32], // start_time
  [3, SINT32], // start_position_lat: must never be read
  [4, SINT32], // start_position_long
  [8, UINT32], // total_timer_time
  [9, UINT32], // total_distance
  [15, UINT8], // avg_heart_rate
  [16, UINT8], // max_heart_rate
  [17, UINT8], // avg_cadence
  [19, UINT16], // avg_power
  [23, UINT8], // intensity
  [24, UINT8], // lap_trigger
  [80, UINT8], // avg_fractional_cadence
  [110, UINT32], // enhanced_avg_speed
  [120, UINT16], // avg_step_length
];
const SPLIT_DEFINITION: FieldDefinition[] = [
  [0, UINT8], // split_type
  [2, UINT32], // total_timer_time
  [3, UINT32], // total_distance
  [4, UINT32], // avg_speed
  [9, UINT32], // start_time
  [15, UINT8], // avg_heart_rate
  [29, UINT16], // avg_cadence
];
const RECORD_DEFINITION: FieldDefinition[] = [
  [0, SINT32], // position_lat
  [1, SINT32], // position_long
  [3, UINT8], // heart_rate
];

const START = 1_000_000_000;
const LAT = 0x1234567;
const LONG = 0x2345678;

function lap(start: number, seconds: number, metres: number, heartRate: number): number[] {
  const speed = (metres / seconds) * 1000;
  return [
    START + start,
    LAT,
    LONG,
    seconds * 1000,
    metres * 100,
    heartRate,
    heartRate + 8,
    85,
    300,
    0,
    2,
    128 / 2,
    speed,
    12_000,
  ];
}

/** A running activity: two laps, per-second records with GPS, warm-up and two reps. */
export function syntheticRunFit(): Uint8Array {
  const builder = new FitBuilder()
    .define(0, RECORD, RECORD_DEFINITION)
    .define(1, LAP, LAP_DEFINITION)
    .define(2, SESSION, SESSION_DEFINITION)
    .define(3, SPLIT, SPLIT_DEFINITION);
  for (let second = 0; second < 5; second += 1) {
    builder.data(0, RECORD_DEFINITION, [LAT, LONG, 140], { compressedTimestamp: second > 0 });
  }
  builder
    .data(1, LAP_DEFINITION, lap(0, 300, 1000, 150))
    .data(1, LAP_DEFINITION, lap(300, 240, 1000, 165))
    // Out of order, as FIT files have them; the warm-up comes first after sorting.
    .data(3, SPLIT_DEFINITION, [3, 120_000, 50_000, 4167, START + 300, 170, 90 * 128])
    .data(3, SPLIT_DEFINITION, [5, 300_000, 100_000, 3333, START, 140, 85 * 128])
    .data(3, SPLIT_DEFINITION, [7, 60_000, 10_000, 1667, START + 420, 130, 80 * 128])
    .data(3, SPLIT_DEFINITION, [17, 600_000, 200_000, 3333, START, 150, 85 * 128])
    .data(2, SESSION_DEFINITION, [1]);
  return builder.build();
}
