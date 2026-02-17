// ── Types ──────────────────────────────────────────────────────────────────

export type Rating = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

export interface DayScore {
  rating: Rating;
  score: number;
}

export interface ForecastDay {
  date: string;
  tempHigh: number | null;
  tempLow: number | null;
  summary: string;
  icon: string;
  rating: Rating;
  score: number;
}

export interface BestWindow {
  start: string;
  end: string;
  days: ForecastDay[];
  totalScore: number;
}

export type RecommendationType =
  | 'tap_now'
  | 'upcoming'
  | 'no_window'
  | 'season_over'
  | 'too_cold';

export interface Recommendation {
  type: RecommendationType;
  message: string;
}

// ── Scoring constants (all in °C) ──────────────────────────────────────────
export const FREEZE_THRESHOLD = 0;
export const THAW_THRESHOLD = 2;
export const IDEAL_LOW_MIN = -7;
export const IDEAL_LOW_MAX = -2;
export const IDEAL_HIGH_MIN = 4;
export const IDEAL_HIGH_MAX = 10;

// ── Scoring logic ──────────────────────────────────────────────────────────

export function scoreDay(tempLow: number, tempHigh: number): DayScore {
  const freezes = tempLow < FREEZE_THRESHOLD;
  const thaws = tempHigh > THAW_THRESHOLD;

  if (!freezes || !thaws) {
    return { rating: 'poor', score: 0 };
  }

  const lowInIdeal = tempLow >= IDEAL_LOW_MIN && tempLow <= IDEAL_LOW_MAX;
  const highInIdeal = tempHigh >= IDEAL_HIGH_MIN && tempHigh <= IDEAL_HIGH_MAX;

  if (lowInIdeal && highInIdeal) {
    return { rating: 'excellent', score: 3 };
  }
  if (lowInIdeal || highInIdeal) {
    return { rating: 'good', score: 2 };
  }
  // Freeze-thaw present but both outside ideal
  return { rating: 'fair', score: 1 };
}

export function findBestWindow(days: ForecastDay[]): BestWindow | null {
  let bestRun: BestWindow | null = null;
  let currentRun: BestWindow | null = null;

  for (const day of days) {
    if (day.score >= 2) {
      // Good or Excellent
      if (!currentRun) {
        currentRun = { start: day.date, end: day.date, days: [day], totalScore: day.score };
      } else {
        currentRun.days.push(day);
        currentRun.totalScore += day.score;
      }
    } else {
      if (currentRun) {
        currentRun.end = currentRun.days[currentRun.days.length - 1].date;
        if (!bestRun || currentRun.days.length > bestRun.days.length ||
            (currentRun.days.length === bestRun.days.length && currentRun.totalScore > bestRun.totalScore)) {
          bestRun = currentRun;
        }
      }
      currentRun = null;
    }
  }
  // Close any trailing run
  if (currentRun) {
    currentRun.end = currentRun.days[currentRun.days.length - 1].date;
    if (!bestRun || currentRun.days.length > bestRun.days.length ||
        (currentRun.days.length === bestRun.days.length && currentRun.totalScore > bestRun.totalScore)) {
      bestRun = currentRun;
    }
  }

  return bestRun;
}

export function generateRecommendation(days: ForecastDay[], bestWindow: BestWindow | null): Recommendation {
  if (!bestWindow || bestWindow.days.length === 0) {
    // Check if it's consistently warm (season over?)
    const allWarm = days.every(d => d.tempLow !== null && d.tempLow > FREEZE_THRESHOLD);
    if (allWarm) {
      return { type: 'season_over', message: 'Season may be over — no freezing nights in the forecast.' };
    }
    // Check if it's consistently frozen
    const allFrozen = days.every(d => d.tempHigh !== null && d.tempHigh <= THAW_THRESHOLD);
    if (allFrozen) {
      return { type: 'too_cold', message: 'Too cold — daytime temperatures aren\'t rising above freezing yet.' };
    }
    return { type: 'no_window', message: 'No strong tapping window in the current forecast.' };
  }

  const startDate = bestWindow.start;
  const isToday = startDate === days[0].date;
  const len = bestWindow.days.length;

  // Single-day windows: not enough for a productive sap run
  if (len === 1) {
    const when = isToday ? 'today' : `coming ${formatDate(startDate)}`;
    return {
      type: 'no_window',
      message: `Only a brief 1-day window ${when} — longer freeze-thaw runs produce much better sap flow.`
    };
  }

  const avgScore = bestWindow.totalScore / len;
  const quality = avgScore >= 2.5 ? 'excellent' : 'good';

  if (isToday) {
    const stretch = len >= 3 ? ' Great stretch for strong sap flow.' : '';
    return {
      type: 'tap_now',
      message: `Tap now — ${quality} conditions for the next ${len} days.${stretch}`
    };
  }

  const startFormatted = formatDate(startDate);
  const windowQuality = len >= 3 ? 'Great' : 'Good';
  return {
    type: 'upcoming',
    message: `${windowQuality} window coming ${startFormatted} — ${len} days of favorable conditions.`
  };
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
