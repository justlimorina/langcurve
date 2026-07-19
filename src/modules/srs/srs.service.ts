import { prisma } from '../../config/prisma.js';
import { dbAdapter, dbMode } from '../../config/db-adapter.js';

export interface SM2Result {
  easiness: number;
  repetitions: number;
  interval: number;
  dueDate: Date;
}

export class SrsService {
  /**
   * Applies the SuperMemo-2 (SM-2) algorithm to calculate the next review parameters
   * @param quality user review rating score (0 - 5)
   * @param currentEF current easiness factor (EF, default is 2.5)
   * @param currentRepetitions current consecutive correct repetition count
   * @param currentInterval current interval in days
   */
  public calculateSM2(
    quality: number,
    currentEF: number,
    currentRepetitions: number,
    currentInterval: number
  ): SM2Result {
    // 1. If quality is poor (< 3), reset consecutive repetitions to 0 and set next review in 1 day
    if (quality < 3) {
      return {
        easiness: Math.max(1.3, currentEF - 0.2), // Reduce EF but keep at least 1.3
        repetitions: 0,
        interval: 1, // review tomorrow
        dueDate: this.addDays(new Date(), 1)
      };
    }

    // 2. Calculate next repetitions and review interval
    let nextRepetitions = currentRepetitions + 1;
    let nextInterval = 1;

    if (nextRepetitions === 1) {
      nextInterval = 1; // 1 day
    } else if (nextRepetitions === 2) {
      nextInterval = 6; // 6 days
    } else {
      nextInterval = Math.round(currentInterval * currentEF);
    }

    // 3. Adjust Easiness Factor (EF)
    const nextEF = currentEF + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    const finalEF = Math.max(1.3, nextEF);

    return {
      easiness: finalEF,
      repetitions: nextRepetitions,
      interval: nextInterval,
      dueDate: this.addDays(new Date(), nextInterval)
    };
  }

  /**
   * Updates user's vocabulary progress inside PostgreSQL database
   */
  public async recordReview(userId: number, word: string, quality: number, topicId: number = 1): Promise<any> {
    if (dbMode === 'DEVELOPMENT_FALLBACK') {
      return await dbAdapter.recordSrsReview(word, quality, topicId);
    }

    // Find or create progress record for user, topic & word
    let progress = await prisma.progress.findUnique({
      where: {
        userId_topicId_word: { userId, topicId, word }
      }
    });

    // If no progress exists, start with defaults
    const currentEF = progress?.easiness ?? 2.5;
    const currentRepetitions = progress?.repetitions ?? 0;
    const currentInterval = progress?.interval ?? 0;

    // Apply SuperMemo-2 calculations
    const sm2Result = this.calculateSM2(quality, currentEF, currentRepetitions, currentInterval);

    // Save back to PostgreSQL
    const updatedProgress = await prisma.progress.upsert({
      where: {
        userId_topicId_word: { userId, topicId, word }
      },
      update: {
        easiness: sm2Result.easiness,
        repetitions: sm2Result.repetitions,
        interval: sm2Result.interval,
        dueDate: sm2Result.dueDate,
        correctCount: {
          increment: quality >= 3 ? 1 : 0
        },
        wrongCount: {
          increment: quality < 3 ? 1 : 0
        }
      },
      create: {
        userId,
        topicId,
        word,
        easiness: sm2Result.easiness,
        repetitions: sm2Result.repetitions,
        interval: sm2Result.interval,
        dueDate: sm2Result.dueDate,
        correctCount: quality >= 3 ? 1 : 0,
        wrongCount: quality < 3 ? 1 : 0
      }
    });

    // Award XP in production
    const xpReward = quality === 5 ? 20 : (quality >= 3 ? 10 : 0);
    if (xpReward > 0) {
      try {
        await prisma.user.update({
          where: { id: userId },
          data: { xp: { increment: xpReward } }
        });
      } catch (e) {
        console.warn('Failed to award production XP:', e);
      }
    }

    return updatedProgress;
  }

  private addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }
}
