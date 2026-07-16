import { prisma } from '../../config/prisma.js';
import { dbAdapter, dbMode } from '../../config/db-adapter.js';
export class TrackingService {
    /**
     * Fetches time-series data points for drawing the user's LangCurve learning curve
     */
    async getLearningCurve(userId) {
        if (dbMode === 'DEVELOPMENT_FALLBACK') {
            return await dbAdapter.getLearningCurve();
        }
        // We execute a group by query over user's progress records in PostgreSQL
        const stats = await prisma.progress.findMany({
            where: {
                userId: userId
            },
            select: {
                dueDate: true,
                easiness: true,
                correctCount: true,
                wrongCount: true
            },
            orderBy: {
                dueDate: 'asc'
            }
        });
        // Process and aggregate by day
        const dayMap = new Map();
        for (const record of stats) {
            const dateKey = record.dueDate.toISOString().split('T')[0]; // YYYY-MM-DD
            const existing = dayMap.get(dateKey) || { count: 0, totalEF: 0, correct: 0, wrong: 0 };
            dayMap.set(dateKey, {
                count: existing.count + 1,
                totalEF: existing.totalEF + record.easiness,
                correct: existing.correct + record.correctCount,
                wrong: existing.wrong + record.wrongCount
            });
        }
        const curvePoints = [];
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
