import { describe, it, expect } from 'vitest';
import { scoreDay, findBestWindow, generateRecommendation, formatDate, type ForecastDay } from './scoring';

// ── Helper to build a day object for findBestWindow / generateRecommendation ──
function day(date: string, tempLow: number, tempHigh: number): ForecastDay {
  const { rating, score } = scoreDay(tempLow, tempHigh);
  return { date, tempLow, tempHigh, summary: '', icon: '', rating, score };
}

// ═══════════════════════════════════════════════════════════════════════════
// scoreDay
// ═══════════════════════════════════════════════════════════════════════════

describe('scoreDay', () => {
  describe('excellent — both low and high in ideal range', () => {
    it('returns excellent for classic ideal conditions (-5°C / 7°C)', () => {
      expect(scoreDay(-5, 7)).toEqual({ rating: 'excellent', score: 3 });
    });

    it('returns excellent at ideal boundary edges (-7°C / 4°C)', () => {
      expect(scoreDay(-7, 4)).toEqual({ rating: 'excellent', score: 3 });
    });

    it('returns excellent at opposite ideal boundary edges (-2°C / 10°C)', () => {
      expect(scoreDay(-2, 10)).toEqual({ rating: 'excellent', score: 3 });
    });
  });

  describe('good — one of low/high in ideal range', () => {
    it('returns good when low is ideal but high is above ideal (-4°C / 14°C)', () => {
      expect(scoreDay(-4, 14)).toEqual({ rating: 'good', score: 2 });
    });

    it('returns good when high is ideal but low is below ideal (-10°C / 6°C)', () => {
      expect(scoreDay(-10, 6)).toEqual({ rating: 'good', score: 2 });
    });

    it('returns good when low is ideal but high is just above threshold (-3°C / 3°C)', () => {
      expect(scoreDay(-3, 3)).toEqual({ rating: 'good', score: 2 });
    });
  });

  describe('fair — freeze-thaw present but neither in ideal range', () => {
    it('returns fair when both outside ideal but freeze-thaw exists (-10°C / 14°C)', () => {
      expect(scoreDay(-10, 14)).toEqual({ rating: 'fair', score: 1 });
    });

    it('returns fair for marginal freeze-thaw (-1°C / 3°C)', () => {
      expect(scoreDay(-1, 3)).toEqual({ rating: 'fair', score: 1 });
    });

    it('returns fair for very cold low with warm high (-15°C / 15°C)', () => {
      expect(scoreDay(-15, 15)).toEqual({ rating: 'fair', score: 1 });
    });
  });

  describe('poor — no freeze-thaw cycle', () => {
    it('returns poor when no freeze (warm night) (3°C / 10°C)', () => {
      expect(scoreDay(3, 10)).toEqual({ rating: 'poor', score: 0 });
    });

    it('returns poor when no thaw (stays frozen) (-10°C / -2°C)', () => {
      expect(scoreDay(-10, -2)).toEqual({ rating: 'poor', score: 0 });
    });

    it('returns poor when exactly at freeze threshold (0°C / 5°C)', () => {
      // tempLow must be < 0 to freeze, so 0 is not freezing
      expect(scoreDay(0, 5)).toEqual({ rating: 'poor', score: 0 });
    });

    it('returns poor when exactly at thaw threshold (-3°C / 2°C)', () => {
      // tempHigh must be > 2 to thaw, so 2 is not thawing
      expect(scoreDay(-3, 2)).toEqual({ rating: 'poor', score: 0 });
    });

    it('returns poor for summer-like conditions (15°C / 25°C)', () => {
      expect(scoreDay(15, 25)).toEqual({ rating: 'poor', score: 0 });
    });

    it('returns poor for deep winter (-25°C / -15°C)', () => {
      expect(scoreDay(-25, -15)).toEqual({ rating: 'poor', score: 0 });
    });
  });

  describe('boundary precision', () => {
    it('low at -7 (inclusive) is in ideal range', () => {
      expect(scoreDay(-7, 7).rating).toBe('excellent');
    });

    it('low at -7.1 is out of ideal range', () => {
      expect(scoreDay(-7.1, 7).rating).toBe('good');
    });

    it('low at -2 (inclusive) is in ideal range', () => {
      expect(scoreDay(-2, 7).rating).toBe('excellent');
    });

    it('low at -1.9 is out of ideal range', () => {
      expect(scoreDay(-1.9, 7).rating).toBe('good');
    });

    it('high at 4 (inclusive) is in ideal range', () => {
      expect(scoreDay(-5, 4).rating).toBe('excellent');
    });

    it('high at 3.9 is out of ideal range', () => {
      expect(scoreDay(-5, 3.9).rating).toBe('good');
    });

    it('high at 10 (inclusive) is in ideal range', () => {
      expect(scoreDay(-5, 10).rating).toBe('excellent');
    });

    it('high at 10.1 is out of ideal range', () => {
      expect(scoreDay(-5, 10.1).rating).toBe('good');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// findBestWindow
// ═══════════════════════════════════════════════════════════════════════════

describe('findBestWindow', () => {
  it('returns null when all days are poor', () => {
    const days = [
      day('2026-02-17', 3, 10),
      day('2026-02-18', 5, 12),
      day('2026-02-19', 2, 8),
    ];
    expect(findBestWindow(days)).toBeNull();
  });

  it('returns null when all days are fair (score 1)', () => {
    const days = [
      day('2026-02-17', -10, 14),
      day('2026-02-18', -1, 3),
    ];
    expect(findBestWindow(days)).toBeNull();
  });

  it('returns a single-day window', () => {
    const days = [
      day('2026-02-17', 3, 10),   // poor
      day('2026-02-18', -5, 7),    // excellent
      day('2026-02-19', 5, 12),    // poor
    ];
    const result = findBestWindow(days);
    expect(result).not.toBeNull();
    expect(result!.start).toBe('2026-02-18');
    expect(result!.end).toBe('2026-02-18');
    expect(result!.days).toHaveLength(1);
  });

  it('returns multi-day consecutive window', () => {
    const days = [
      day('2026-02-17', -5, 7),    // excellent
      day('2026-02-18', -4, 6),    // excellent
      day('2026-02-19', -3, 5),    // excellent
      day('2026-02-20', 3, 10),    // poor
    ];
    const result = findBestWindow(days);
    expect(result!.start).toBe('2026-02-17');
    expect(result!.end).toBe('2026-02-19');
    expect(result!.days).toHaveLength(3);
  });

  it('picks the longer window when there are two runs', () => {
    const days = [
      day('2026-02-17', -5, 7),    // excellent
      day('2026-02-18', 3, 10),    // poor (breaks run)
      day('2026-02-19', -4, 6),    // excellent
      day('2026-02-20', -3, 5),    // excellent
      day('2026-02-21', -6, 8),    // excellent
    ];
    const result = findBestWindow(days);
    expect(result!.start).toBe('2026-02-19');
    expect(result!.days).toHaveLength(3);
  });

  it('picks higher total score when runs are equal length', () => {
    const days = [
      day('2026-02-17', -10, 6),   // good (score 2)
      day('2026-02-18', -10, 6),   // good (score 2)
      day('2026-02-19', 3, 10),    // poor (breaks run)
      day('2026-02-20', -5, 7),    // excellent (score 3)
      day('2026-02-21', -4, 6),    // excellent (score 3)
    ];
    const result = findBestWindow(days);
    // Both runs are length 2, but second has score 6 vs 4
    expect(result!.start).toBe('2026-02-20');
    expect(result!.totalScore).toBe(6);
  });

  it('handles trailing run (no poor day at end)', () => {
    const days = [
      day('2026-02-17', 3, 10),    // poor
      day('2026-02-18', -5, 7),    // excellent
      day('2026-02-19', -4, 6),    // excellent
    ];
    const result = findBestWindow(days);
    expect(result!.start).toBe('2026-02-18');
    expect(result!.end).toBe('2026-02-19');
    expect(result!.days).toHaveLength(2);
  });

  it('handles empty days array', () => {
    expect(findBestWindow([])).toBeNull();
  });

  it('includes good days (score 2) in windows', () => {
    const days = [
      day('2026-02-17', -4, 14),   // good (score 2 — low ideal, high not)
      day('2026-02-18', -5, 7),    // excellent (score 3)
    ];
    const result = findBestWindow(days);
    expect(result!.days).toHaveLength(2);
    expect(result!.totalScore).toBe(5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// generateRecommendation
// ═══════════════════════════════════════════════════════════════════════════

describe('generateRecommendation', () => {
  describe('tap_now — best window starts today', () => {
    it('recommends tapping now for excellent multi-day window starting today', () => {
      const days = [
        day('2026-02-17', -5, 7),
        day('2026-02-18', -4, 6),
        day('2026-02-19', -3, 5),
        day('2026-02-20', 3, 10),
      ];
      const bestWindow = findBestWindow(days);
      const rec = generateRecommendation(days, bestWindow);
      expect(rec.type).toBe('tap_now');
      expect(rec.message).toContain('Tap now');
      expect(rec.message).toContain('excellent');
      expect(rec.message).toContain('3 days');
    });

    it('says "good" quality when avg score < 2.5', () => {
      const days = [
        day('2026-02-17', -10, 6),  // good (2)
        day('2026-02-18', -10, 6),  // good (2)
        day('2026-02-19', 3, 10),   // poor
      ];
      const bestWindow = findBestWindow(days);
      const rec = generateRecommendation(days, bestWindow);
      expect(rec.type).toBe('tap_now');
      expect(rec.message).toContain('good');
    });

    it('uses singular "day" for a 1-day window', () => {
      const days = [
        day('2026-02-17', -5, 7),   // excellent
        day('2026-02-18', 3, 10),   // poor
      ];
      const bestWindow = findBestWindow(days);
      const rec = generateRecommendation(days, bestWindow);
      expect(rec.type).toBe('tap_now');
      expect(rec.message).toMatch(/1 day\b/);
    });
  });

  describe('upcoming — best window starts in the future', () => {
    it('recommends an upcoming window', () => {
      const days = [
        day('2026-02-17', 3, 10),    // poor
        day('2026-02-18', -5, 7),     // excellent
        day('2026-02-19', -4, 6),     // excellent
        day('2026-02-20', 3, 10),     // poor
      ];
      const bestWindow = findBestWindow(days);
      const rec = generateRecommendation(days, bestWindow);
      expect(rec.type).toBe('upcoming');
      expect(rec.message).toContain('Good window coming');
      expect(rec.message).toContain('2 days');
    });
  });

  describe('season_over — all nights above freezing', () => {
    it('detects season may be over', () => {
      const days = [
        day('2026-02-17', 5, 15),
        day('2026-02-18', 3, 12),
        day('2026-02-19', 8, 20),
      ];
      const rec = generateRecommendation(days, null);
      expect(rec.type).toBe('season_over');
      expect(rec.message).toContain('Season may be over');
    });
  });

  describe('too_cold — all days stay frozen', () => {
    it('detects too cold conditions', () => {
      const days = [
        day('2026-02-17', -20, -5),
        day('2026-02-18', -18, -3),
        day('2026-02-19', -15, 0),
      ];
      const rec = generateRecommendation(days, null);
      expect(rec.type).toBe('too_cold');
      expect(rec.message).toContain('Too cold');
    });
  });

  describe('no_window — mixed but no good consecutive days', () => {
    it('returns no_window for mixed conditions with no good run', () => {
      const days = [
        day('2026-02-17', -10, 14),  // fair
        day('2026-02-18', 3, 10),    // poor
        day('2026-02-19', -1, 3),    // fair
      ];
      const rec = generateRecommendation(days, null);
      expect(rec.type).toBe('no_window');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// formatDate
// ═══════════════════════════════════════════════════════════════════════════

describe('formatDate', () => {
  it('formats a date string in en-US short format', () => {
    const result = formatDate('2026-02-17');
    // Should contain day of week, month, and day number
    expect(result).toMatch(/Tue/);
    expect(result).toMatch(/Feb/);
    expect(result).toMatch(/17/);
  });

  it('handles different dates correctly', () => {
    const result = formatDate('2026-03-01');
    expect(result).toMatch(/Sun/);
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/1/);
  });
});
