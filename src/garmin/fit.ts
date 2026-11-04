// Reads laps and splits from a Garmin activity download: a ZIP holding one FIT file.
// Written for this project rather than using Garmin's FIT SDK, which has a proprietary
// license and decodes every message. This reader steps over the per-second records
// without parsing them and reads only the fields listed below. Position fields aren't
// listed, so location data never leaves this file.

import { GarminError } from './errors';

export type FitMessage = Record<string, number>;

export interface FitActivity {
  sessions: FitMessage[];
  laps: FitMessage[];
  splits: FitMessage[];
}

/** Field number → output name and FIT scale (value = raw / scale). */
type FieldTable = Record<number, readonly [name: string, scale?: number]>;

const SESSION_FIELDS: FieldTable = {
  5: ['sport'],
};

const LAP_FIELDS: FieldTable = {
  2: ['startTime'],
  7: ['elapsedTime', 1000],
  8: ['timerTime', 1000],
  9: ['distance', 100],
  11: ['calories'],
  13: ['avgSpeed', 1000],
  14: ['maxSpeed', 1000],
  15: ['avgHeartRate'],
  16: ['maxHeartRate'],
  17: ['avgCadence'],
  18: ['maxCadence'],
  19: ['avgPower'],
  20: ['maxPower'],
  21: ['ascent'],
  22: ['descent'],
  23: ['intensity'],
  24: ['trigger'],
  50: ['avgTemperature'],
  52: ['movingTime', 1000],
  77: ['verticalOscillation', 10],
  79: ['stanceTime', 10],
  80: ['avgFractionalCadence', 128],
  110: ['enhancedAvgSpeed', 1000],
  111: ['enhancedMaxSpeed', 1000],
  118: ['verticalRatio', 100],
  120: ['stepLength', 10],
  136: ['avgRespiration', 100],
  161: ['avgGradeAdjustedSpeed', 1000],
};

const SPLIT_FIELDS: FieldTable = {
  0: ['type'],
  1: ['elapsedTime', 1000],
  2: ['timerTime', 1000],
  3: ['distance', 100],
  4: ['avgSpeed', 1000],
  9: ['startTime'],
  13: ['ascent'],
  14: ['descent'],
  15: ['avgHeartRate'],
  16: ['maxHeartRate'],
  25: ['maxSpeed', 1000],
  28: ['calories'],
  29: ['avgCadence', 128],
  30: ['maxCadence', 128],
  32: ['avgTemperature'],
  35: ['verticalOscillation', 10],
  36: ['verticalRatio', 100],
  37: ['stanceTime', 10],
  39: ['stepLength', 10],
  40: ['avgPower'],
  41: ['maxPower'],
  93: ['avgGradeAdjustedSpeed', 1000],
  110: ['movingTime', 1000],
};

const MESSAGE_TABLES: Record<number, [keyof FitActivity, FieldTable]> = {
  18: ['sessions', SESSION_FIELDS],
  19: ['laps', LAP_FIELDS],
  312: ['splits', SPLIT_FIELDS],
};

interface WantedField {
  name: string;
  scale: number;
  offset: number;
  baseType: number;
}

interface Definition {
  size: number;
  littleEndian: boolean;
  fields: WantedField[];
  target: FitMessage[] | null;
}

/** Byte width of the numeric FIT base types, by the low five bits of the type. */
const BASE_TYPE_SIZE = [1, 1, 1, 2, 2, 4, 4];

/** A scalar field's value, or null for FIT's "invalid" marker. */
function readValue(
  view: DataView,
  offset: number,
  baseType: number,
  littleEndian: boolean,
): number | null {
  let value: number;
  let invalid: number;
  switch (baseType) {
    case 1:
      value = view.getInt8(offset);
      invalid = 0x7f;
      break;
    case 3:
      value = view.getInt16(offset, littleEndian);
      invalid = 0x7fff;
      break;
    case 4:
      value = view.getUint16(offset, littleEndian);
      invalid = 0xffff;
      break;
    case 5:
      value = view.getInt32(offset, littleEndian);
      invalid = 0x7fffffff;
      break;
    case 6:
      value = view.getUint32(offset, littleEndian);
      invalid = 0xffffffff;
      break;
    default:
      value = view.getUint8(offset);
      invalid = 0xff;
  }
  return value === invalid ? null : value;
}

/** Reads a definition message at `offset`; returns it and where the next record starts. */
function readDefinition(
  view: DataView,
  start: number,
  hasDeveloperFields: boolean,
  activity: FitActivity,
): { definition: Definition; next: number } {
  const littleEndian = view.getUint8(start + 1) === 0;
  const globalNumber = view.getUint16(start + 2, littleEndian);
  const fieldCount = view.getUint8(start + 4);
  const [targetName, table] = MESSAGE_TABLES[globalNumber] ?? [];
  const fields: WantedField[] = [];

  let offset = start + 5;
  let size = 0;
  for (let index = 0; index < fieldCount; index += 1, offset += 3) {
    const fieldSize = view.getUint8(offset + 1);
    const wanted = table?.[view.getUint8(offset)];
    const baseType = view.getUint8(offset + 2) & 0x1f;
    // Arrays and strings have a size other than their type's; no listed field is one.
    if (wanted && BASE_TYPE_SIZE[baseType] === fieldSize) {
      fields.push({ name: wanted[0], scale: wanted[1] ?? 1, offset: size, baseType });
    }
    size += fieldSize;
  }
  if (hasDeveloperFields) {
    const developerCount = view.getUint8(offset);
    offset += 1;
    for (let index = 0; index < developerCount; index += 1, offset += 3) {
      size += view.getUint8(offset + 1);
    }
  }
  const target = targetName ? activity[targetName] : null;
  return { definition: { size, littleEndian, fields, target }, next: offset };
}

function readMessage(view: DataView, start: number, definition: Definition): FitMessage {
  const message: FitMessage = {};
  for (const field of definition.fields) {
    const value = readValue(view, start + field.offset, field.baseType, definition.littleEndian);
    if (value !== null) message[field.name] = value / field.scale;
  }
  return message;
}

function readRecords(view: DataView, start: number, end: number, activity: FitActivity): void {
  const definitions: (Definition | undefined)[] = [];
  let offset = start;
  while (offset < end) {
    const header = view.getUint8(offset);
    offset += 1;
    const compressedTimestamp = (header & 0x80) !== 0;
    if (!compressedTimestamp && (header & 0x40) !== 0) {
      const read = readDefinition(view, offset, (header & 0x20) !== 0, activity);
      definitions[header & 0x0f] = read.definition;
      offset = read.next;
      continue;
    }
    const definition = definitions[compressedTimestamp ? (header >> 5) & 0x03 : header & 0x0f];
    if (!definition) throw new Error('FIT data message without a definition');
    definition.target?.push(readMessage(view, offset, definition));
    offset += definition.size;
  }
}

function isFitHeader(view: DataView, start: number): boolean {
  if (start + 12 > view.byteLength) return false;
  const headerSize = view.getUint8(start);
  return (headerSize === 12 || headerSize === 14) && view.getUint32(start + 8, true) === 0x5449462e; // ".FIT"
}

/** Laps, splits and sessions of a FIT file (several FIT files may be chained in one). */
export function parseFit(bytes: Uint8Array): FitActivity {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!isFitHeader(view, 0)) throw new Error('Not a FIT file');
  const activity: FitActivity = { sessions: [], laps: [], splits: [] };
  let start = 0;
  while (isFitHeader(view, start)) {
    const dataStart = start + view.getUint8(start);
    const dataEnd = dataStart + view.getUint32(start + 4, true);
    readRecords(view, dataStart, dataEnd, activity);
    start = dataEnd + 2; // the file's CRC
  }
  return activity;
}

/** The first .fit file in a ZIP, inflated with the runtime's native decompression. */
export async function unzipFit(zip: Uint8Array): Promise<Uint8Array> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

  let directoryEnd = zip.length - 22;
  while (directoryEnd >= 0 && view.getUint32(directoryEnd, true) !== 0x06054b50) directoryEnd -= 1;
  if (directoryEnd < 0) throw new Error('Not a ZIP file');

  const entryCount = view.getUint16(directoryEnd + 10, true);
  let entry = view.getUint32(directoryEnd + 16, true);
  for (let index = 0; index < entryCount; index += 1) {
    const method = view.getUint16(entry + 10, true);
    const compressedSize = view.getUint32(entry + 20, true);
    const nameLength = view.getUint16(entry + 28, true);
    const extraLength = view.getUint16(entry + 30, true);
    const commentLength = view.getUint16(entry + 32, true);
    const localHeader = view.getUint32(entry + 42, true);
    const name = new TextDecoder().decode(zip.subarray(entry + 46, entry + 46 + nameLength));

    if (name.toLowerCase().endsWith('.fit')) {
      const dataStart =
        localHeader +
        30 +
        view.getUint16(localHeader + 26, true) +
        view.getUint16(localHeader + 28, true);
      const data = zip.subarray(dataStart, dataStart + compressedSize);
      if (method === 0) return data;
      if (method !== 8) throw new Error('Unsupported ZIP compression');
      const inflated = new Blob([data])
        .stream()
        .pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(inflated).arrayBuffer());
    }
    entry += 46 + nameLength + extraLength + commentLength;
  }
  throw new GarminError('invalid_response', 'The Garmin activity file has no FIT data.');
}

/** Laps and splits from an activity download. Unreadable files become a GarminError. */
export async function readActivityFile(zip: Uint8Array, what: string): Promise<FitActivity> {
  try {
    return parseFit(await unzipFit(zip));
  } catch (error) {
    if (error instanceof GarminError) throw error;
    throw new GarminError('invalid_response', `Could not read the Garmin file for ${what}.`);
  }
}
