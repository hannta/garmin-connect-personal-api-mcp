// Food log and hydration as logged in Garmin Connect. No data on the owner's account,
// so the formatting follows Garmin's OpenAPI spec.

import { z } from 'zod';
import { LIMITS, getFoodLog, getHydrationRange } from '../garmin/endpoints';
import type {
  DailyHydration,
  LoggedFood,
  MealDetails,
  NutritionGoals,
  NutritionTotals,
} from '../garmin/types';
import { round } from '../lib/units';
import { dateInput, defineTool } from './define';
import { rangeInput, resolveRange, summarize } from './range';

type Maybe = number | null | undefined;

function hydrationRow(day: DailyHydration) {
  return {
    date: day.calendarDate?.slice(0, 10),
    intake_ml: round(day.valueInML),
    goal_ml: round(day.goalInML),
    sweat_loss_ml: round(day.sweatLossInML),
    activity_intake_ml: round(day.activityIntakeInML),
  };
}

export const getHydrationTool = defineTool({
  name: 'garmin_get_hydration',
  title: 'Get Garmin hydration',
  description: [
    'Hydration per day over a date range, as logged in Garmin Connect: intake, goal,',
    'estimated sweat loss and intake during activities (ml). Only has data if the user',
    'logs hydration.',
    `Defaults to the last 7 days; at most ${LIMITS.hydrationRangeDays} days per call.`,
  ].join(' '),
  inputSchema: z.object(rangeInput(LIMITS.hydrationRangeDays)),
  async run(input, context) {
    const range = await resolveRange(input, context, LIMITS.hydrationRangeDays, 'Hydration');
    const days = ((await getHydrationRange(context.client, range.start, range.end)) ?? [])
      .map(hydrationRow)
      .filter((day) => day.date && (day.intake_ml ?? 0) + (day.sweat_loss_ml ?? 0) > 0)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (days.length === 0) {
      return {
        start_date: range.start,
        end_date: range.end,
        no_data: true,
        note: 'No hydration logged in this range.',
      };
    }
    return {
      start_date: range.start,
      end_date: range.end,
      days,
      summary: summarize(days, ['intake_ml', 'sweat_loss_ml']),
    };
  },
});

function macros(totals: NutritionTotals | null | undefined, servings = 1) {
  const scale = (value: Maybe, decimals: number) =>
    typeof value === 'number' ? round(value * servings, decimals) : null;
  return {
    calories_kcal: scale(totals?.calories, 0),
    carbs_g: scale(totals?.carbs, 1),
    protein_g: scale(totals?.protein, 1),
    fat_g: scale(totals?.fat, 1),
  };
}

function goals(goal: NutritionGoals | null | undefined) {
  if (!goal) return null;
  return {
    ...macros(goal),
    // Adjusted goals include extra for active calories burned.
    adjusted_calories_kcal: round(goal.adjustedCalories),
    adjusted_carbs_g: round(goal.adjustedCarbs, 1),
    adjusted_protein_g: round(goal.adjustedProtein, 1),
    adjusted_fat_g: round(goal.adjustedFat, 1),
  };
}

function foodRow(food: LoggedFood) {
  const servings = typeof food.servingQty === 'number' ? food.servingQty : 1;
  const content = food.nutritionContent;
  return {
    name: food.foodMetaData?.foodName,
    brand: food.foodMetaData?.brandName,
    servings: round(servings, 2),
    serving:
      content?.servingUnit != null
        ? `${content.numberOfUnits ?? 1} ${content.servingUnit}`.trim()
        : null,
    time: food.mealTime?.slice(0, 5),
    // `nutritionContent` is one serving; totals are per serving × servings.
    ...macros(content, servings),
  };
}

function mealRow(meal: MealDetails) {
  return {
    name: meal.meal?.mealName ?? meal.meal?.defaultMealName,
    ...macros(meal.mealNutritionContent),
    foods: (meal.loggedFoods ?? []).map(foodRow),
  };
}

export const getFoodLogTool = defineTool({
  name: 'garmin_get_food_log',
  title: 'Get Garmin food log',
  description: [
    "One day's food log from Garmin Connect: calories, carbs, protein and fat eaten",
    'against the daily goals (adjusted goals include active calories), then each meal with',
    'its logged foods. Food totals are per serving × servings. Only has meals if the user',
    'logs food in Garmin Connect.',
  ].join(' '),
  inputSchema: z.object({
    date: dateInput("Calendar date, YYYY-MM-DD. Default: today in the user's time zone."),
  }),
  async run(input, context) {
    const date = input.date ?? (await context.today());
    const log = await getFoodLog(context.client, date);
    const meals = (log?.mealDetails ?? [])
      .filter((meal) => (meal.loggedFoods?.length ?? 0) > 0)
      .map(mealRow);
    const dailyGoals = goals(log?.dailyNutritionGoals);
    if (meals.length === 0) {
      return { date, no_data: true, goals: dailyGoals, note: 'No food logged for this date.' };
    }
    return { date, eaten: macros(log?.dailyNutritionContent), goals: dailyGoals, meals };
  },
});
