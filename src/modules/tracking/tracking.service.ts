import { prisma } from '../../config/prisma.js';
import { dbAdapter, dbMode } from '../../config/db-adapter.js';

export interface CurveDataPoint {
  date: string;
  wordCount: number;
  avgEasiness: number;
  correctReviews: number;
  wrongReviews: number;
}

export class TrackingService {
  /**
   * Fetches time-series data points for drawing the user's LangCurve learning curve
   */
  public async getLearningCurve(userId: number): Promise<CurveDataPoint[]> {
    if (dbMode === 'DEVELOPMENT_FALLBACK') {
      return await dbAdapter.getLearningCurve();
    }

    // We fetch all historical review logs for the user from PostgreSQL
    const logs = await prisma.reviewLog.findMany({
      where: {
        userId: userId
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    // Process and aggregate by day
    const dayMap = new Map<string, { count: number; totalEF: number; correct: number; wrong: number }>();

    for (const record of logs) {
      const dateKey = record.createdAt.toISOString().split('T')[0]; // YYYY-MM-DD
      const existing = dayMap.get(dateKey) || { count: 0, totalEF: 0, correct: 0, wrong: 0 };
      
      dayMap.set(dateKey, {
        count: existing.count + 1,
        totalEF: existing.totalEF + record.easiness,
        correct: existing.correct + (record.quality >= 3 ? 1 : 0),
        wrong: existing.wrong + (record.quality < 3 ? 1 : 0)
      });
    }

    const curvePoints: CurveDataPoint[] = [];
    dayMap.forEach((val, key) => {
      curvePoints.push({
        date: key,
        wordCount: val.count,
        avgEasiness: parseFloat((val.totalEF / val.count).toFixed(2)),
        correctReviews: val.correct,
        wrongReviews: val.wrong
      });
    });

    // Sort by date key ascending
    return curvePoints.sort((a, b) => a.date.localeCompare(b.date));
  }
}
