// Metric conversions from Garmin base units (m, s, m/s, g) to what a runner reads.
// Every function returns null for missing or invalid input instead of throwing, so tools
// can pass Garmin's optional fields straight through.

type Maybe = number | null | undefined;

function isFiniteNumber(value: Maybe): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function round(value: Maybe, decimals = 0): number | null {
  if (!isFiniteNumber(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function metersToKm(meters: Maybe, decimals = 2): number | null {
  return isFiniteNumber(meters) ? round(meters / 1000, decimals) : null;
}

export function speedToKmh(metersPerSecond: Maybe, decimals = 1): number | null {
  return isFiniteNumber(metersPerSecond) ? round(metersPerSecond * 3.6, decimals) : null;
}

/** Pace in min/km as "m:ss" from speed in m/s. */
export function speedToPace(metersPerSecond: Maybe): string | null {
  if (!isFiniteNumber(metersPerSecond) || metersPerSecond <= 0) return null;
  return formatMinutesSeconds(1000 / metersPerSecond);
}

/** Swimming pace in min/100 m as "m:ss" from speed in m/s. */
export function speedToPacePer100m(metersPerSecond: Maybe): string | null {
  if (!isFiniteNumber(metersPerSecond) || metersPerSecond <= 0) return null;
  return formatMinutesSeconds(100 / metersPerSecond);
}

/** Pace in min/km as "m:ss" from a duration in seconds per kilometre. */
export function secondsPerKmToPace(seconds: Maybe): string | null {
  return isFiniteNumber(seconds) && seconds > 0 ? formatMinutesSeconds(seconds) : null;
}

function formatMinutesSeconds(totalSeconds: number): string {
  const rounded = Math.round(totalSeconds);
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Duration as "h:mm:ss", or "m:ss" under an hour — for activities. */
export function formatDuration(seconds: Maybe): string | null {
  if (!isFiniteNumber(seconds) || seconds < 0) return null;
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hours === 0) return `${minutes}:${String(secs).padStart(2, '0')}`;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/** Duration as "7h 32m" — for sleep and other daily totals. */
export function formatHoursMinutes(seconds: Maybe): string | null {
  if (!isFiniteNumber(seconds) || seconds < 0) return null;
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}

export function gramsToKg(grams: Maybe, decimals = 1): number | null {
  return isFiniteNumber(grams) ? round(grams / 1000, decimals) : null;
}
