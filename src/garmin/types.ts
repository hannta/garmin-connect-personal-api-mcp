// Response types for the Garmin Personal API endpoints this project uses. Only the fields
// we read are declared, and all are optional/nullable: Garmin omits fields for days or
// devices without the data. Shapes were checked against the live API
// (docs/garmin-api-notes.md).
// Units are Garmin's: meters, seconds, m/s, bpm, grams; GMT timestamps without offset.

type N = number | null | undefined;
type S = string | null | undefined;

export interface ProfileSettings {
  timeZone?: S;
  measurementSystem?: S;
  preferredLocale?: S;
  firstDayOfWeek?: { dayName?: S } | null;
  /** e.g. ["MONDAY", "WEDNESDAY"]; set in Garmin Connect for training plans. */
  availableTrainingDays?: string[] | null;
  preferredLongTrainingDays?: string[] | null;
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
  restingHrAutoUpdateUsed?: boolean | null;
}

export interface DailySummary {
  calendarDate: string;
  includesWellnessData?: boolean | null;
  includesActivityData?: boolean | null;
  movement?: {
    steps?: { value?: N; goal?: N; distanceInMeters?: N } | null;
    floorsAscended?: { value?: N } | null;
  } | null;
  calories?: {
    burnedTotal?: N;
    burnedActive?: N;
    burnedResting?: N;
    consumedValue?: N;
    consumedGoal?: N;
  } | null;
  heartRate?: { restingValue?: N; minValue?: N; maxValue?: N; alertCount?: N } | null;
  hydration?: { goalInMl?: N; consumedInMl?: N; consumedInFractionalMl?: N } | null;
  intensityMinutes?: { moderate?: N; vigorous?: N; goal?: N } | null;
  stress?: {
    avgLevel?: N;
    maxLevel?: N;
    restProportion?: N;
    lowStressProportion?: N;
    mediumStressProportion?: N;
    highStressProportion?: N;
    restDurationInMillis?: N;
    activityDurationInMillis?: N;
    lowStressDurationInMillis?: N;
    mediumStressDurationInMillis?: N;
    highStressDurationInMillis?: N;
  } | null;
  bodyBattery?: {
    minValue?: N;
    maxValue?: N;
    chargedValue?: N;
    drainedValue?: N;
    latestValue?: N;
    /** Latest value before sleep. */
    endOfDayValue?: N;
    activityEvents?: SummaryBodyBatteryEvent[] | null;
    dynamicFeedbackEvent?: BodyBatteryFeedback | null;
  } | null;
  respiration?: { avgValue?: N; minValue?: N; maxValue?: N } | null;
}

export interface DailySummariesResponse {
  data?: DailySummary[] | null;
}

export interface SleepScoreItem {
  value?: N;
  qualifierKey?: S;
  /** Optimal range: seconds for total duration, % for stage percentages, else the score's unit. */
  optimalStart?: N;
  optimalEnd?: N;
}

/** Sleep need in minutes, with the reasons Garmin adjusted it. */
export interface SleepNeed {
  baseline?: N;
  actual?: N;
  feedback?: S;
  trainingFeedback?: S;
  sleepHistoryAdjustment?: S;
  hrvAdjustment?: S;
  napAdjustment?: S;
  /** Minutes since local midnight. */
  recommendedBedtimeStartMins?: N;
  recommendedBedtimeEndMins?: N;
}

export interface DailyNap {
  napTimeSec?: N;
  napStartTimestampGMT?: S;
  napEndTimestampGMT?: S;
  /** Minutes from UTC. */
  napStartTimeOffset?: N;
  napFeedback?: S;
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
  sleepScorePersonalizedInsight?: S;
  lowestRespirationValue?: N;
  highestRespirationValue?: N;
  breathingDisruptionSeverity?: S;
  dailyNapDTOS?: DailyNap[] | null;
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
  sleepNeed?: SleepNeed | null;
  /** Sleep need for the coming night. */
  nextSleepNeed?: SleepNeed | null;
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
  isPR?: boolean | null;
  /** In the spec; not seen in the owner's data. */
  vO2MaxValue?: N;
  lactateThresholdBpm?: N;
  totalSets?: N;
  activeSets?: N;
  totalReps?: N;
  summarizedExerciseSets?: SummarizedExerciseSet[] | null;
}

/** Strength totals per exercise category. Weight in grams, duration in ms. */
export interface SummarizedExerciseSet {
  category?: S;
  subCategory?: S;
  sets?: N;
  reps?: N;
  /** Sum of weight (g) × reps. */
  volume?: N;
  maxWeight?: N;
  duration?: N;
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
  avgStepFrequency?: N;
  /** Meters. */
  avgStepLength?: N;
}

/** Activity details. Times are "YYYY-MM-DDTHH:MM:SS.s" strings. */
export interface ActivityDetail {
  activityId: number;
  activityName?: S;
  description?: S;
  activityTypeDTO?: ActivityType | null;
  timeZoneUnitDTO?: { timeZone?: S } | null;
  metadataDTO?: {
    lapCount?: N;
    manualActivity?: boolean | null;
    personalRecord?: boolean | null;
  } | null;
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
    minTemperature?: N;
    maxTemperature?: N;
    avgRespirationRate?: N;
    minRespirationRate?: N;
    maxRespirationRate?: N;
    minElevation?: N;
    maxElevation?: N;
    maxRunCadence?: N;
    /** Estimated sweat loss, ml. */
    waterEstimated?: N;
    aerobicTrainingEffectMessage?: S;
    anaerobicTrainingEffectMessage?: S;
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

/** Weights in grams; percentages as numbers. */
export interface WeightMeasurement {
  calendarDate?: S;
  weight?: N;
  bmi?: N;
  bodyFat?: N;
  bodyWater?: N;
  boneMass?: N;
  muscleMass?: N;
  visceralFat?: N;
  sourceType?: S;
}

export interface DailyWeightSummary {
  summaryDate: string;
  numOfWeightEntries?: N;
  minWeight?: N;
  maxWeight?: N;
  latestWeight?: WeightMeasurement | null;
}

export interface WeightRangeResponse {
  dailyWeightSummaries?: DailyWeightSummary[] | null;
  totalAverage?: WeightMeasurement | null;
  previousDateWeight?: WeightMeasurement | null;
}

/** A Body Battery event in the daily summary; times are Garmin local + GMT strings. */
export interface SummaryBodyBatteryEvent {
  eventType?: S;
  eventStartTimeGmt?: S;
  eventStartTimeLocal?: S;
  durationInMillis?: N;
  bodyBatteryImpact?: N;
  feedbackType?: S;
  shortFeedback?: S;
}

export interface BodyBatteryFeedback {
  eventTimestampGmt?: S;
  bodyBatteryLevel?: S;
  feedbackShortType?: S;
}

/** A Body Battery event in the daily report; `timezoneOffset` is in milliseconds. */
export interface BodyBatteryEvent {
  eventType?: S;
  eventStartTimeGmt?: S;
  timezoneOffset?: N;
  durationInMilliseconds?: N;
  bodyBatteryImpact?: N;
  feedbackType?: S;
  shortFeedback?: S;
}

export interface BodyBatteryDay {
  date: string;
  charged?: N;
  drained?: N;
  /** [epoch ms, level] pairs. */
  bodyBatteryValuesArray?: [number, number | null][] | null;
  bodyBatteryActivityEvent?: BodyBatteryEvent[] | null;
  bodyBatteryDynamicFeedbackEvent?: BodyBatteryFeedback | null;
  endOfDayBodyBatteryDynamicFeedbackEvent?: BodyBatteryFeedback | null;
}

/** Durations are in seconds. */
export interface DailyStress {
  calendarDate: string;
  values?: {
    overallStressLevel?: N;
    restStressDuration?: N;
    lowStressDuration?: N;
    mediumStressDuration?: N;
    highStressDuration?: N;
  } | null;
}

export interface DailySteps {
  calendarDate: string;
  totalSteps?: N;
  /** Meters. */
  totalDistance?: N;
  stepGoal?: N;
}

export interface DailyHeartRate {
  calendarDate?: S;
  maxHeartRate?: N;
  minHeartRate?: N;
  restingHeartRate?: N;
  lastSevenDaysAvgRestingHeartRate?: N;
  /** [epoch ms, bpm] pairs. */
  heartRateValues?: [number, number | null][] | null;
  abnormalHrThresholdValue?: N;
  lowAbnormalHrThresholdValue?: N;
  /** Readings above / below the thresholds; [epoch ms, bpm] per the spec's example. */
  abnormalHRValuesArray?: unknown[][] | null;
}

export interface Spo2Day {
  calendarDate?: S;
  averageSpO2?: N;
  lowestSpO2?: N;
  latestSpO2?: N;
  avgSleepSpO2?: N;
  lastSevenDaysAvgSpO2?: N;
  /** [epoch ms, SpO2 %, altitude m] per hour. */
  spO2HourlyAverages?: [number, number | null, number | null][] | null;
}

interface FitnessAgeComponent {
  value?: N;
  stale?: boolean | null;
  lastMeasurementDate?: S;
}

export interface FitnessAge {
  chronologicalAge?: N;
  fitnessAge?: N;
  previousFitnessAge?: N;
  components?: {
    vigorousDaysAvg?: FitnessAgeComponent | null;
    vigorousMinutesAvg?: FitnessAgeComponent | null;
    rhr?: FitnessAgeComponent | null;
    bmi?: FitnessAgeComponent | null;
  } | null;
  lastUpdated?: S;
  achievableFitnessAge?: N;
  /** Why there is no fitness age, e.g. USER_EMPTY_AGE. */
  invalidReason?: S;
}

export interface WeightGoal {
  userGoalType?: S;
  startDate?: S;
  endDate?: S;
  goalName?: S;
  /** Grams for WEIGHT_GRAMS goals. */
  goalValue?: N;
}

export interface WeightGoalsResponse {
  userGoals?: WeightGoal[] | null;
}

// Types below follow Garmin's OpenAPI spec (developer.garmin.com, Personal API Swagger
// docs) for endpoints without data on the owner's account. The spec describes dates and
// times as objects, but real responses send strings, so both forms are accepted.

/** "YYYY-MM-DD", or the spec's { date (UTC), localDate }. */
export type ConnectDate = string | { date?: S; localDate?: S } | null | undefined;
/** A timestamp string, or the spec's { date (UTC), localDate }. */
export type ConnectTimestamp = string | { date?: S; localDate?: S } | null | undefined;

export interface DailyHydration {
  calendarDate?: S;
  valueInML?: N;
  goalInML?: N;
  sweatLossInML?: N;
  activityIntakeInML?: N;
}

export interface WellnessActivitySummary {
  calendarDate?: ConnectDate;
  activityName?: S;
  notes?: S;
  wellnessActivityType?: S;
  startTimestampGMT?: ConnectTimestamp;
  endTimestampGMT?: ConnectTimestamp;
  startTimestampLocal?: ConnectTimestamp;
  endTimestampLocal?: ConnectTimestamp;
  /** summaryType: HEART_RATE, WRIST_HEART_RATE, STRESS, RESPIRATION, SPO2, RMSSD_HRV, SDRR_HRV. */
  summaryTypeDataList?: { summaryType?: S; minValue?: N; maxValue?: N; avgValue?: N }[] | null;
  timeInZoneList?: { zoneNumber?: N; millisInZone?: N; zoneLowBoundary?: N }[] | null;
}

/** Calories in kcal; carbs, protein and fat in grams. */
export interface NutritionTotals {
  calories?: N;
  carbs?: N;
  protein?: N;
  fat?: N;
}

export interface NutritionGoals extends NutritionTotals {
  adjustedCalories?: N;
  adjustedCarbs?: N;
  adjustedProtein?: N;
  adjustedFat?: N;
}

/** Nutrition of one serving. */
export interface NutritionContent extends NutritionTotals {
  fiber?: N;
  sugar?: N;
  sodium?: N;
  numberOfUnits?: N;
  servingUnit?: S;
}

export interface LoggedFood {
  foodMetaData?: { foodName?: S; brandName?: S } | null;
  /** Multiplier for `nutritionContent`, which is one serving. */
  servingQty?: N;
  nutritionContent?: NutritionContent | null;
  mealTime?: S;
}

export interface MealDetails {
  meal?: { mealName?: S; defaultMealName?: S; displayOrder?: N } | null;
  mealNutritionContent?: NutritionTotals | null;
  mealNutritionGoals?: NutritionGoals | null;
  loggedFoods?: LoggedFood[] | null;
}

export interface DailyNutritionSummary {
  mealDate?: S;
  dailyNutritionContent?: NutritionTotals | null;
  dailyNutritionGoals?: NutritionGoals | null;
  mealDetails?: MealDetails[] | null;
}

export interface MenstrualCycleSummary {
  startDate?: ConnectDate;
  endDate?: ConnectDate;
  cycleType?: S;
  /** Phase identifier; the spec doesn't list the values. */
  currentPhase?: N;
  dayInCycle?: N;
  daysUntilNextPhase?: N;
  lengthOfCurrentPhase?: N;
  periodLength?: N;
  fertileWindowStart?: N;
  lengthOfFertileWindow?: N;
  lutealPhaseStart?: N;
  predictedCycle?: boolean | null;
  predictedCycleLength?: N;
  predictedOvulationDate?: ConnectDate;
  isSkinTempMct?: boolean | null;
  feedbackPhrase?: S;
  pregnancyCycle?: boolean | null;
  numberOfWeek?: N;
  dueDate?: ConnectDate;
  deliveryDate?: ConnectDate;
  analysis?: {
    perimenopauseDetected?: boolean | null;
    cycleTypeAnalysis?: {
      cycleType?: S;
      medianCycleLength?: N;
      medianCycleLengthClassifier?: S;
      cycleVariability?: N;
      cycleVariabilityClassifier?: S;
      cycleLengthDeviationDays?: N;
      periodLengthDeviationDays?: N;
      follicularLengthDeviationDays?: N;
      lutealLengthDeviationDays?: N;
      isAtypical?: boolean | null;
      hasAmenorrhea?: boolean | null;
      prolongedPeriods?: N;
      prolongedPeriodsClassifier?: S;
    } | null;
  } | null;
}

export interface MenstrualDayLog {
  flow?: S;
  symptoms?: string[] | null;
  moods?: string[] | null;
  discharge?: string[] | null;
  ovulationDay?: boolean | null;
  notes?: S;
  babyMovements?:
    { count?: N; duration?: N; movementType?: S; startTimestamp?: ConnectTimestamp }[] | null;
}

export interface MenstrualDayView {
  dayLog?: MenstrualDayLog | null;
  daySummary?: MenstrualCycleSummary | null;
  weightGoals?: { weekNum?: N; lowWeightGoalInGrams?: N; highWeightGoalInGrams?: N } | null;
}

export interface WorkoutStep {
  stepIndex?: N;
  name?: S;
  /** ACTIVE, WARMUP, COOLDOWN, REST, RECOVERY, … */
  intensity?: S;
  /** TIME, DISTANCE, REPS, HR_LESS_THAN, HR_GREATER_THAN, OPEN, REPEAT_UNTIL_STEPS_CMPLT, … */
  durationType?: S;
  durationValue?: N;
  /** HEART_RATE, SPEED, CADENCE, POWER, SWIM_STROKE, OPEN, … */
  targetType?: S;
  targetValue?: N;
  targetValueLow?: N;
  targetValueHigh?: N;
  notes?: S;
  equipmentType?: S;
  exerciseCategory?: S;
  exerciseName?: S;
  /** Kilograms. */
  exerciseWeightValue?: N;
}

export interface ActivityWorkout {
  index?: N;
  workoutName?: S;
  sport?: S;
  timeCreated?: S;
  workoutPhrase?: S;
  steps?: WorkoutStep[] | null;
}
