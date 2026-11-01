// Response types for the Garmin Personal API endpoints this project uses. Only the fields
// we read are declared, and all are optional/nullable: Garmin omits fields for days or
// devices without the data. Shapes were recorded in Phase 0 (discovery/FINDINGS.md).
// Units are Garmin's: meters, seconds, m/s, bpm, grams; GMT timestamps without offset.

type N = number | null | undefined;
type S = string | null | undefined;

export interface ProfileSettings {
  timeZone?: S;
  measurementSystem?: S;
  preferredLocale?: S;
  firstDayOfWeek?: { dayName?: S } | null;
}

export interface HeartRateZones {
  sport?: S;
  trainingMethod?: S;
  zone1Floor?: N;
  zone2Floor?: N;
  zone3Floor?: N;
  zone4Floor?: N;
  zone5Floor?: N;
  maxHeartRateUsed?: N;
  restingHeartRateUsed?: N;
  lactateThresholdHeartRateUsed?: N;
}

export interface DailySummary {
  calendarDate: string;
  includesWellnessData?: boolean | null;
  includesActivityData?: boolean | null;
  movement?: {
    steps?: { value?: N; goal?: N; distanceInMeters?: N } | null;
    floorsAscended?: { value?: N } | null;
  } | null;
  calories?: { burnedTotal?: N; burnedActive?: N; burnedResting?: N } | null;
  heartRate?: { restingValue?: N; minValue?: N; maxValue?: N } | null;
  intensityMinutes?: { moderate?: N; vigorous?: N; goal?: N } | null;
  stress?: {
    avgLevel?: N;
    maxLevel?: N;
    restProportion?: N;
    lowStressProportion?: N;
    mediumStressProportion?: N;
    highStressProportion?: N;
  } | null;
  bodyBattery?: {
    minValue?: N;
    maxValue?: N;
    chargedValue?: N;
    drainedValue?: N;
    latestValue?: N;
  } | null;
  respiration?: { avgValue?: N; minValue?: N; maxValue?: N } | null;
}

export interface DailySummariesResponse {
  data?: DailySummary[] | null;
}

export interface SleepScoreItem {
  value?: N;
  qualifierKey?: S;
}

export interface DailySleep {
  calendarDate?: S;
  sleepTimeSeconds?: N;
  napTimeSeconds?: N;
  sleepStartTimestampGMT?: N;
  sleepEndTimestampGMT?: N;
  deepSleepSeconds?: N;
  lightSleepSeconds?: N;
  remSleepSeconds?: N;
  awakeSleepSeconds?: N;
  awakeCount?: N;
  avgHeartRate?: N;
  avgSleepStress?: N;
  averageRespirationValue?: N;
  averageSpO2Value?: N;
  lowestSpO2Value?: N;
  sleepScoreFeedback?: S;
  sleepScoreInsight?: S;
  sleepScores?: Partial<
    Record<
      | 'overall'
      | 'totalDuration'
      | 'stress'
      | 'awakeCount'
      | 'restlessness'
      | 'remPercentage'
      | 'lightPercentage'
      | 'deepPercentage',
      SleepScoreItem | null
    >
  > | null;
  sleepNeed?: { baseline?: N; actual?: N; feedback?: S } | null;
}

export interface HrvSummary {
  calendarDate: string;
  weeklyAvg?: N;
  lastNightAvg?: N;
  lastNight5MinHigh?: N;
  baseline?: { lowUpper?: N; balancedLow?: N; balancedUpper?: N; markerValue?: N } | null;
  status?: S;
  feedbackPhrase?: S;
}

export interface HrvReading {
  hrvValue?: N;
  readingTimeGMT?: S;
}

export interface HrvDay {
  hrvSummary?: HrvSummary | null;
  hrvReadings?: HrvReading[] | null;
  startTimestampGMT?: S;
  endTimestampGMT?: S;
}

export interface HrvRangeResponse {
  hrvSummaries?: HrvSummary[] | null;
}

export interface ActivityType {
  typeKey?: S;
  typeId?: N;
  parentTypeId?: N;
}

/** One item from activity search. Times are "YYYY-MM-DD HH:MM:SS" strings. */
export interface ActivitySummary {
  activityId: number;
  activityName?: S;
  startTimeGMT?: S;
  startTimeLocal?: S;
  activityType?: ActivityType | null;
  distance?: N;
  duration?: N;
  movingDuration?: N;
  elevationGain?: N;
  elevationLoss?: N;
  averageSpeed?: N;
  avgGradeAdjustedSpeed?: N;
  averageHR?: N;
  maxHR?: N;
  calories?: N;
  averageRunningCadenceInStepsPerMinute?: N;
  avgPower?: N;
  normPower?: N;
  aerobicTrainingEffect?: N;
  anaerobicTrainingEffect?: N;
  trainingEffectLabel?: S;
  activityTrainingLoad?: N;
  moderateIntensityMinutes?: N;
  vigorousIntensityMinutes?: N;
  hrTimeInZone_1?: N;
  hrTimeInZone_2?: N;
  hrTimeInZone_3?: N;
  hrTimeInZone_4?: N;
  hrTimeInZone_5?: N;
  powerTimeInZone_1?: N;
  powerTimeInZone_2?: N;
  powerTimeInZone_3?: N;
  powerTimeInZone_4?: N;
  powerTimeInZone_5?: N;
  differenceBodyBattery?: N;
  lapCount?: N;
  fastestSplit_1000?: N;
  fastestSplit_1609?: N;
  fastestSplit_5000?: N;
  fastestSplit_10000?: N;
  fastestSplit_21098?: N;
  fastestSplit_42195?: N;
}

export interface SplitSummary {
  splitType?: S;
  noOfSplits?: N;
  distance?: N;
  duration?: N;
  averageSpeed?: N;
  avgGradeAdjustedSpeed?: N;
  averageHR?: N;
  maxHR?: N;
  averagePower?: N;
  averageRunCadence?: N;
}

/** Activity details. Times are "YYYY-MM-DDTHH:MM:SS.s" strings. */
export interface ActivityDetail {
  activityId: number;
  activityName?: S;
  description?: S;
  activityTypeDTO?: ActivityType | null;
  timeZoneUnitDTO?: { timeZone?: S } | null;
  metadataDTO?: { lapCount?: N; manualActivity?: boolean | null } | null;
  summaryDTO?: {
    startTimeGMT?: S;
    startTimeLocal?: S;
    distance?: N;
    duration?: N;
    movingDuration?: N;
    elapsedDuration?: N;
    elevationGain?: N;
    elevationLoss?: N;
    averageSpeed?: N;
    averageMovingSpeed?: N;
    maxSpeed?: N;
    avgGradeAdjustedSpeed?: N;
    calories?: N;
    averageHR?: N;
    maxHR?: N;
    minHR?: N;
    averageRunCadence?: N;
    averagePower?: N;
    normalizedPower?: N;
    maxPower?: N;
    groundContactTime?: N;
    strideLength?: N;
    verticalOscillation?: N;
    verticalRatio?: N;
    trainingEffect?: N;
    anaerobicTrainingEffect?: N;
    trainingEffectLabel?: S;
    activityTrainingLoad?: N;
    directWorkoutFeel?: N;
    directWorkoutRpe?: N;
    moderateIntensityMinutes?: N;
    vigorousIntensityMinutes?: N;
    differenceBodyBattery?: N;
    averageTemperature?: N;
    avgRespirationRate?: N;
    beginPotentialStamina?: N;
    endPotentialStamina?: N;
    minAvailableStamina?: N;
  } | null;
  splitSummaries?: SplitSummary[] | null;
}

/** Garmin-downsampled streams; `metrics[i]` follows `metricDescriptors[i]`. */
export interface ActivityStreams {
  activityId?: N;
  metricDescriptors?: { metricsIndex: number; key: string; unit?: { key?: S } | null }[] | null;
  activityDetailMetrics?: { metrics: (number | null)[] }[] | null;
  detailsAvailable?: boolean | null;
}
