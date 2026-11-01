import { describe, expect, it } from 'vitest';
import {
  speedToPacePer100m,
  formatDuration,
  formatHoursMinutes,
  gramsToKg,
  metersToKm,
  round,
  secondsPerKmToPace,
  speedToKmh,
  speedToPace,
} from '../src/lib/units';

describe('units', () => {
  it('rounds and passes through missing values', () => {
    expect(round(1.256, 2)).toBe(1.26);
    expect(round(null)).toBeNull();
    expect(round(undefined)).toBeNull();
    expect(round(Number.NaN)).toBeNull();
  });

  it('converts distance', () => {
    expect(metersToKm(21097.5)).toBe(21.1);
    expect(metersToKm(10217.71, 2)).toBe(10.22);
    expect(metersToKm(null)).toBeNull();
  });

  it('converts speed to km/h and pace', () => {
    expect(speedToKmh(3.333)).toBe(12);
    expect(speedToPace(3.333)).toBe('5:00');
    expect(speedToPace(2.613)).toBe('6:23');
    expect(speedToPace(4.76)).toBe('3:30');
    expect(speedToPace(0)).toBeNull();
    expect(speedToPace(-1)).toBeNull();
    expect(speedToPace(null)).toBeNull();
  });

  it('formats seconds per km as pace', () => {
    expect(secondsPerKmToPace(282.143)).toBe('4:42');
    expect(secondsPerKmToPace(0)).toBeNull();
  });

  it('carries rounding into the next minute', () => {
    expect(speedToPace(1000 / 299.6)).toBe('5:00');
    expect(formatDuration(59.6)).toBe('1:00');
  });

  it('formats activity durations', () => {
    expect(formatDuration(3910.68)).toBe('1:05:11');
    expect(formatDuration(1536.49)).toBe('25:36');
    expect(formatDuration(11008.8)).toBe('3:03:29');
    expect(formatDuration(-1)).toBeNull();
  });

  it('formats daily durations', () => {
    expect(formatHoursMinutes(27420)).toBe('7h 37m');
    expect(formatHoursMinutes(1440)).toBe('24m');
    expect(formatHoursMinutes(null)).toBeNull();
  });

  it('converts grams to kg', () => {
    expect(gramsToKg(76505)).toBe(76.5);
    expect(gramsToKg(undefined)).toBeNull();
  });
});

describe('speedToPacePer100m', () => {
  it('formats swimming pace', () => {
    expect(speedToPacePer100m(1)).toBe('1:40');
    expect(speedToPacePer100m(0)).toBeNull();
  });
});
