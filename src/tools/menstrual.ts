// Menstrual cycle tracking from Garmin Connect. No data on the owner's account, so the
// formatting follows Garmin's OpenAPI spec. Sexual activity and sex drive logs are
// deliberately not returned.

import { z } from 'zod';
import { getMenstrualDay, getMenstrualSummary } from '../garmin/endpoints';
import type { MenstrualCycleSummary, MenstrualDayLog } from '../garmin/types';
import { garminDate, garminTimestampToLocalIso } from '../lib/dates';
import { gramsToKg } from '../lib/units';
import { dateInput, defineTool } from './define';

const NO_DATA = 'No menstrual cycle data for this date (cycle tracking may be off).';

const PHASE_NOTE =
  "phase_id is Garmin's own phase number, which Garmin doesn't document; use day_in_cycle with period_length_days, fertile_window and luteal_phase_start_day to tell the phase.";

export function formatCycleSummary(summary: MenstrualCycleSummary) {
  const fertileStart = summary.fertileWindowStart;
  const fertileLength = summary.lengthOfFertileWindow;
  const analysis = summary.analysis;
  const type = analysis?.cycleTypeAnalysis;
  return {
    cycle_start_date: garminDate(summary.startDate),
    cycle_end_date: garminDate(summary.endDate),
    cycle_type: summary.cycleType,
    predicted_cycle: summary.predictedCycle,
    day_in_cycle: summary.dayInCycle,
    phase_id: summary.currentPhase,
    phase_length_days: summary.lengthOfCurrentPhase,
    days_until_next_phase: summary.daysUntilNextPhase,
    period_length_days: summary.periodLength,
    fertile_window:
      typeof fertileStart === 'number' && typeof fertileLength === 'number' && fertileLength > 0
        ? { from_day: fertileStart, to_day: fertileStart + fertileLength - 1 }
        : null,
    luteal_phase_start_day: summary.lutealPhaseStart,
    predicted_cycle_length_days: summary.predictedCycleLength,
    predicted_ovulation_date: garminDate(summary.predictedOvulationDate),
    uses_skin_temperature: summary.isSkinTempMct,
    feedback: summary.feedbackPhrase,
    pregnancy: summary.pregnancyCycle
      ? {
          week: summary.numberOfWeek,
          due_date: garminDate(summary.dueDate),
          delivery_date: garminDate(summary.deliveryDate),
        }
      : null,
    analysis: analysis
      ? {
          median_cycle_length_days: type?.medianCycleLength,
          median_cycle_length_class: type?.medianCycleLengthClassifier,
          cycle_variability: type?.cycleVariability,
          cycle_variability_class: type?.cycleVariabilityClassifier,
          cycle_length_deviation_days: type?.cycleLengthDeviationDays,
          period_length_deviation_days: type?.periodLengthDeviationDays,
          follicular_length_deviation_days: type?.follicularLengthDeviationDays,
          luteal_length_deviation_days: type?.lutealLengthDeviationDays,
          atypical: type?.isAtypical,
          amenorrhea: type?.hasAmenorrhea,
          prolonged_periods: type?.prolongedPeriods,
          prolonged_periods_class: type?.prolongedPeriodsClassifier,
          perimenopause_detected: analysis.perimenopauseDetected,
        }
      : null,
  };
}

function hasCycle(summary: MenstrualCycleSummary | null | undefined): boolean {
  return Boolean(summary && (summary.startDate || typeof summary.dayInCycle === 'number'));
}

export const getMenstrualCycleTool = defineTool({
  name: 'garmin_get_menstrual_cycle',
  title: 'Get Garmin menstrual cycle',
  description: [
    'Menstrual cycle around a date, from cycle tracking in Garmin Connect: day in cycle,',
    'phase, period length, fertile window, predicted cycle length and ovulation date, and',
    "Garmin's cycle analysis (median length, variability). Useful for relating training,",
    'HRV and resting heart rate to the cycle. Only has data if the user tracks their cycle',
    'in Garmin Connect.',
  ].join(' '),
  inputSchema: z.object({
    date: dateInput("Calendar date, YYYY-MM-DD. Default: today in the user's time zone."),
  }),
  async run(input, context) {
    const date = input.date ?? (await context.today());
    const summary = await getMenstrualSummary(context.client, date);
    if (!summary || !hasCycle(summary)) return { date, no_data: true, note: NO_DATA };
    return { date, ...formatCycleSummary(summary), note: PHASE_NOTE };
  },
});

function formatDayLog(log: MenstrualDayLog, timeZone: string) {
  const list = (values: string[] | null | undefined) =>
    values && values.length > 0 ? values : null;
  return {
    flow: log.flow,
    symptoms: list(log.symptoms),
    moods: list(log.moods),
    discharge: list(log.discharge),
    ovulation_day: log.ovulationDay,
    notes: log.notes,
    baby_movements: log.babyMovements?.length
      ? log.babyMovements.map((movement) => ({
          type: movement.movementType,
          count: movement.count,
          duration_s: movement.duration,
          start: garminTimestampToLocalIso(null, movement.startTimestamp, timeZone),
        }))
      : null,
  };
}

export const getMenstrualDayTool = defineTool({
  name: 'garmin_get_menstrual_day',
  title: 'Get Garmin menstrual cycle day',
  description: [
    'One day of menstrual cycle tracking: what was logged (flow, symptoms, moods,',
    "ovulation day, notes) and that day's cycle summary (same fields as",
    'garmin_get_menstrual_cycle). During pregnancy tracking it adds the weekly weight-gain',
    'range. Only has data if the user tracks their cycle in Garmin Connect.',
  ].join(' '),
  inputSchema: z.object({
    date: dateInput("Calendar date, YYYY-MM-DD. Default: today in the user's time zone."),
  }),
  async run(input, context) {
    const zone = await context.timeZone();
    const today = await context.today();
    const date = input.date ?? today;
    const view = await getMenstrualDay(context.client, date, today);
    const log = view?.dayLog ? formatDayLog(view.dayLog, zone.timeZone) : null;
    const loggedSomething = log && Object.values(log).some((value) => value != null);
    if (!loggedSomething && !hasCycle(view?.daySummary)) {
      return { date, no_data: true, note: NO_DATA };
    }
    const goals = view?.weightGoals;
    return {
      date,
      logged: loggedSomething ? log : null,
      cycle:
        view?.daySummary && hasCycle(view.daySummary) ? formatCycleSummary(view.daySummary) : null,
      pregnancy_weight_gain_kg: goals
        ? {
            week: goals.weekNum,
            low: gramsToKg(goals.lowWeightGoalInGrams),
            high: gramsToKg(goals.highWeightGoalInGrams),
          }
        : null,
      note: PHASE_NOTE,
      warning: zone.warning,
    };
  },
});
