import { prisma } from './prisma.js';
import { WordCache } from '../modules/dictionary/word-cache.model.js';
import { redis } from './redis.js';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import fs from 'fs';
import path from 'path';

// Define DB Mode
export let dbMode: 'PRODUCTION' | 'DEVELOPMENT_FALLBACK' = 'PRODUCTION';

// In-Memory Cache for Redis fallback
const inMemoryCache = new Map<string, { value: string; expiry: number }>();

// SQLite instance for PostgreSQL fallback
let sqliteDb: Database | null = null;

// JSON File Cache for MongoDB fallback
const JSON_CACHE_DIR = path.resolve('./.cache');
const JSON_CACHE_FILE = path.join(JSON_CACHE_DIR, 'word_cache.json');

// Interface definitions to keep clean abstraction
export interface IDbAdapter {
  getStats(): Promise<any>;
  getTopics(): Promise<any[]>;
  createTopic(name: string, description?: string): Promise<any>;
  getVocabularies(topicId: number): Promise<any[]>;
  upsertVocabulary(topicId: number, word: string, userExample?: string): Promise<any>;
  updateExample(vocabId: number, userExample?: string): Promise<any>;
  deleteVocabulary(vocabId: number): Promise<any>;
  recordSrsReview(word: string, quality: number): Promise<any>;
  getLearningCurve(): Promise<any[]>;
}

export interface ICacheAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX: number }): Promise<void>;
}

export interface IDocStoreAdapter {
  findWord(word: string): Promise<any | null>;
  saveWord(word: string, source: string, rawPayload: any): Promise<void>;
}

// 1. REDIS CLIENT ADAPTER WITH IN-MEMORY FALLBACK
class RedisAdapter implements ICacheAdapter {
  async get(key: string): Promise<string | null> {
    if (dbMode === 'PRODUCTION') {
      try {
        return await redis.get(key);
      } catch (e) {
        console.warn('[Redis] Connection lost, switching to memory lookup');
      }
    }
    const cached = inMemoryCache.get(key);
    if (cached) {
      if (Date.now() > cached.expiry) {
        inMemoryCache.delete(key);
        return null;
      }
      return cached.value;
    }
    return null;
  }

  async set(key: string, value: string, options?: { EX: number }): Promise<void> {
    if (dbMode === 'PRODUCTION') {
      try {
        await redis.set(key, value, { EX: options?.EX });
        return;
      } catch (e) {
        console.warn('[Redis] Connection lost, caching in memory');
      }
    }
    const expiry = Date.now() + (options?.EX ? options.EX * 1000 : 604800000);
    inMemoryCache.set(key, { value, expiry });
  }
}

// 2. MONGODB ADAPTER WITH LOCAL JSON FILE STORE FALLBACK
class DocStoreAdapter implements IDocStoreAdapter {
  async findWord(word: string): Promise<any | null> {
    if (dbMode === 'PRODUCTION') {
      try {
        const doc = await WordCache.findOne({ word });
        return doc ? doc.rawPayload : null;
      } catch (e) {
        console.warn('[MongoDB] Connection lost, switching to Local JSON lookup');
      }
    }
    return this.readFromJsonCache(word);
  }

  async saveWord(word: string, source: string, rawPayload: any): Promise<void> {
    if (dbMode === 'PRODUCTION') {
      try {
        await WordCache.create({ word, source, rawPayload });
        return;
      } catch (e) {
        console.warn('[MongoDB] Connection lost, saving to Local JSON');
      }
    }
    this.writeToJsonCache(word, source, rawPayload);
  }

  private readFromJsonCache(word: string): any | null {
    if (!fs.existsSync(JSON_CACHE_FILE)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(JSON_CACHE_FILE, 'utf-8'));
      return data[word] ? data[word].rawPayload : null;
    } catch (e) {
      return null;
    }
  }

  private writeToJsonCache(word: string, source: string, rawPayload: any): void {
    if (!fs.existsSync(JSON_CACHE_DIR)) {
      fs.mkdirSync(JSON_CACHE_DIR, { recursive: true });
    }
    let data: any = {};
    if (fs.existsSync(JSON_CACHE_FILE)) {
      try {
        data = JSON.parse(fs.readFileSync(JSON_CACHE_FILE, 'utf-8'));
      } catch (e) {
        data = {};
      }
    }
    data[word] = { source, rawPayload, createdAt: new Date() };
    fs.writeFileSync(JSON_CACHE_FILE, JSON.stringify(data, null, 2));
  }
}

// 3. POSTGRESQL (PRISMA) ADAPTER WITH LOCAL SQLITE FALLBACK
class DbAdapter implements IDbAdapter {
  async getStats(): Promise<any> {
    if (dbMode === 'PRODUCTION') {
      try {
        const totalTopics = await prisma.topic.count();
        const totalWords = await prisma.progress.count();
        const totalExamples = await prisma.progress.count({
          where: { userExample: { not: null } }
        });
        const user = await prisma.user.findUnique({ where: { id: 1 } });
        return { total_topics: totalTopics, total_words: totalWords, total_examples: totalExamples, xp: user?.xp || 0 };
      } catch (e) {
        this.fallbackToDevMode();
      }
    }
    const topics = await sqliteDb!.all('SELECT id FROM topics');
    const vocabs = await sqliteDb!.all('SELECT id, user_example FROM vocabularies');
    const userRow = await sqliteDb!.get('SELECT xp FROM users WHERE id = 1');
    const examplesCount = vocabs.filter((v: any) => v.user_example && v.user_example.trim() !== '').length;
    return {
      total_topics: topics.length,
      total_words: vocabs.length,
      total_examples: examplesCount,
      xp: userRow?.xp || 0
    };
  }

  async getTopics(): Promise<any[]> {
    if (dbMode === 'PRODUCTION') {
      try {
        const topics = await prisma.topic.findMany({ orderBy: { name: 'asc' } });
        return await Promise.all(topics.map(async (t) => {
          const count = await prisma.progress.count({ where: { topicId: t.id } });
          return { ...t, word_count: count };
        }));
      } catch (e) {
        this.fallbackToDevMode();
      }
    }
    const topics = await sqliteDb!.all('SELECT * FROM topics ORDER BY name ASC');
    return await Promise.all(topics.map(async (t: any) => {
      const row = await sqliteDb!.get('SELECT COUNT(*) as count FROM vocabularies WHERE topic_id = ?', [t.id]);
      return { id: t.id, name: t.name, description: t.description, word_count: row?.count || 0 };
    }));
  }

  async createTopic(name: string, description?: string): Promise<any> {
    if (dbMode === 'PRODUCTION') {
      try {
        return await prisma.topic.create({
          data: { name: name.trim(), description: description ? description.trim() : null }
        });
      } catch (e) {
        this.fallbackToDevMode();
      }
    }
    const result = await sqliteDb!.run(
      'INSERT INTO topics (name, description) VALUES (?, ?)',
      [name.trim(), description ? description.trim() : null]
    );
    return { id: result.lastID, name: name.trim(), description };
  }

  async getVocabularies(topicId: number): Promise<any[]> {
    if (dbMode === 'PRODUCTION') {
      try {
        return await prisma.progress.findMany({
          where: { topicId },
          orderBy: { dueDate: 'asc' }
        });
      } catch (e) {
        this.fallbackToDevMode();
      }
    }
    const rows = await sqliteDb!.all('SELECT * FROM vocabularies WHERE topic_id = ? ORDER BY due_date ASC', [topicId]);
    return rows.map((r: any) => ({
      id: r.id,
      topicId: r.topic_id,
      word: r.word,
      userExample: r.user_example,
      easiness: r.easiness || 2.5,
      interval: r.interval || 0,
      repetitions: r.repetitions || 0,
      dueDate: new Date(r.due_date || Date.now())
    }));
  }

  async upsertVocabulary(topicId: number, word: string, userExample?: string): Promise<any> {
    if (dbMode === 'PRODUCTION') {
      try {
        return await prisma.progress.upsert({
          where: { userId_word: { userId: 1, word: word.trim().toLowerCase() } },
          update: { topicId, userExample: userExample ? userExample.trim() : undefined },
          create: { userId: 1, topicId, word: word.trim().toLowerCase(), userExample: userExample ? userExample.trim() : null }
        });
      } catch (e) {
        this.fallbackToDevMode();
      }
    }
    const existing = await sqliteDb!.get('SELECT id FROM vocabularies WHERE word = ?', [word.trim().toLowerCase()]);
    if (existing) {
      await sqliteDb!.run(
        'UPDATE vocabularies SET topic_id = ?, user_example = ? WHERE id = ?',
        [topicId, userExample ? userExample.trim() : null, existing.id]
      );
      return { id: existing.id, topicId, word: word.trim().toLowerCase(), userExample };
    } else {
      const res = await sqliteDb!.run(
        'INSERT INTO vocabularies (topic_id, word, user_example, easiness, interval, repetitions, due_date) VALUES (?, ?, ?, 2.5, 0, 0, ?)',
        [topicId, word.trim().toLowerCase(), userExample ? userExample.trim() : null, new Date().toISOString()]
      );
      return { id: res.lastID, topicId, word: word.trim().toLowerCase(), userExample };
    }
  }

  async updateExample(vocabId: number, userExample?: string): Promise<any> {
    if (dbMode === 'PRODUCTION') {
      try {
        const p = await prisma.progress.update({
          where: { id: vocabId },
          data: { userExample: userExample ? userExample.trim() : null }
        });
        return { id: vocabId, userExample: p.userExample };
      } catch (e) {
        this.fallbackToDevMode();
      }
    }
    await sqliteDb!.run('UPDATE vocabularies SET user_example = ? WHERE id = ?', [userExample ? userExample.trim() : null, vocabId]);
    return { id: vocabId, userExample };
  }

  async deleteVocabulary(vocabId: number): Promise<any> {
    if (dbMode === 'PRODUCTION') {
      try {
        await prisma.progress.delete({ where: { id: vocabId } });
        return { message: 'Deleted' };
      } catch (e) {
        this.fallbackToDevMode();
      }
    }
    await sqliteDb!.run('DELETE FROM vocabularies WHERE id = ?', [vocabId]);
    return { message: 'Deleted' };
  }

  async recordSrsReview(word: string, quality: number): Promise<any> {
    if (dbMode === 'PRODUCTION') {
      try {
        // Handled in SrsService using Prisma directly
        return null; 
      } catch (e) {
        this.fallbackToDevMode();
      }
    }

    const row = await sqliteDb!.get('SELECT * FROM vocabularies WHERE word = ?', [word.trim().toLowerCase()]);
    const currentEF = row?.easiness || 2.5;
    const currentRepetitions = row?.repetitions || 0;
    const currentInterval = row?.interval || 0;

    // Apply SM-2 calculation
    let nextRepetitions = currentRepetitions;
    let nextInterval = currentInterval;
    let nextEF = currentEF;

    if (quality < 3) {
      nextEF = Math.max(1.3, currentEF - 0.2);
      nextRepetitions = 0;
      nextInterval = 1;
    } else {
      nextRepetitions = currentRepetitions + 1;
      if (nextRepetitions === 1) nextInterval = 1;
      else if (nextRepetitions === 2) nextInterval = 6;
      else nextInterval = Math.round(currentInterval * currentEF);

      nextEF = currentEF + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
      nextEF = Math.max(1.3, nextEF);
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + nextInterval);

    if (row) {
      await sqliteDb!.run(
        'UPDATE vocabularies SET easiness = ?, repetitions = ?, interval = ?, due_date = ? WHERE id = ?',
        [nextEF, nextRepetitions, nextInterval, dueDate.toISOString(), row.id]
      );
    }
    const xpReward = quality === 5 ? 20 : (quality >= 3 ? 10 : 0);
    if (xpReward > 0) {
      await sqliteDb!.run('UPDATE users SET xp = xp + ? WHERE id = 1', [xpReward]);
    }
    return { word, easiness: nextEF, repetitions: nextRepetitions, interval: nextInterval, dueDate };
  }

  async getLearningCurve(): Promise<any[]> {
    if (dbMode === 'PRODUCTION') {
      try {
        // Handled in TrackingService using Prisma directly
        return []; 
      } catch (e) {
        this.fallbackToDevMode();
      }
    }
    const rows = await sqliteDb!.all('SELECT due_date, easiness FROM vocabularies');
    const dayMap = new Map<string, { count: number; totalEF: number }>();
    for (const r of rows) {
      const dateKey = new Date(r.due_date || Date.now()).toISOString().split('T')[0];
      const existing = dayMap.get(dateKey) || { count: 0, totalEF: 0 };
      dayMap.set(dateKey, { count: existing.count + 1, totalEF: existing.totalEF + (r.easiness || 2.5) });
    }
    return Array.from(dayMap.entries()).map(([date, val]) => ({
      date,
      wordCount: val.count,
      avgEasiness: parseFloat((val.totalEF / val.count).toFixed(2)),
      correctReviews: val.count,
      wrongReviews: 0
    })).sort((a, b) => a.date.localeCompare(b.date));
  }

  private fallbackToDevMode() {
    if (dbMode === 'PRODUCTION') {
      console.warn('\n⚠️ [Database Warning] Failed to communicate with production databases.');
      console.warn('⚠️ Switching dynamically to local SQLite fallback database...\n');
      dbMode = 'DEVELOPMENT_FALLBACK';
    }
  }
}

export const dbAdapter: IDbAdapter = new DbAdapter();
export const cacheAdapter: ICacheAdapter = new RedisAdapter();
export const docStoreAdapter: IDocStoreAdapter = new DocStoreAdapter();

// Initialize SQLite fallback database tables if needed
export async function initializeSqliteFallback() {
  sqliteDb = await open({
    filename: './langcurve.db',
    driver: sqlite3.Database
  });

  await sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      description TEXT
    );
    CREATE TABLE IF NOT EXISTS vocabularies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER,
      word TEXT UNIQUE,
      user_example TEXT,
      easiness REAL DEFAULT 2.5,
      interval INTEGER DEFAULT 0,
      repetitions INTEGER DEFAULT 0,
      due_date TEXT
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      xp INTEGER DEFAULT 0
    );
  `);

  // Schema check & upgrade for existing databases from mockup session
  try {
    const tableInfo = await sqliteDb.all("PRAGMA table_info(vocabularies)");
    const hasDefinition = tableInfo.some((col: any) => col.name === 'definition');
    if (hasDefinition) {
      // Recreate table if old mockup version with definition NOT NULL constraint exists
      await sqliteDb.exec(`
        DROP TABLE IF EXISTS vocabularies;
        CREATE TABLE vocabularies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          topic_id INTEGER,
          word TEXT UNIQUE,
          user_example TEXT,
          easiness REAL DEFAULT 2.5,
          interval INTEGER DEFAULT 0,
          repetitions INTEGER DEFAULT 0,
          due_date TEXT
        );
      `);
      console.log('Migrated old SQLite vocabularies table to new schema (removed NOT NULL definition).');
    } else {
      const hasDueDate = tableInfo.some((col: any) => col.name === 'due_date');
      if (!hasDueDate) {
        await sqliteDb.exec(`
          ALTER TABLE vocabularies ADD COLUMN easiness REAL DEFAULT 2.5;
          ALTER TABLE vocabularies ADD COLUMN interval INTEGER DEFAULT 0;
          ALTER TABLE vocabularies ADD COLUMN repetitions INTEGER DEFAULT 0;
          ALTER TABLE vocabularies ADD COLUMN due_date TEXT;
        `);
        console.log('Upgraded existing SQLite database with SRS scheduling columns.');
      }
    }
  } catch (e) {
    console.error('Failed to verify or upgrade SQLite schema:', e);
  }

  // Seed default fallback topics
  const count = await sqliteDb.get('SELECT COUNT(*) as count FROM topics');
  if (count?.count === 0) {
    await sqliteDb.run("INSERT INTO topics (name, description) VALUES ('Technology', 'Vocabulary related to computers, coding, software, and the digital world.')");
    await sqliteDb.run("INSERT INTO topics (name, description) VALUES ('Business & Career', 'Vocabulary for professional environments, meetings, finance, and office life.')");
    await sqliteDb.run("INSERT INTO topics (name, description) VALUES ('Travel & Leisure', 'Words and phrases for commuting, exploring new places, hotel stays, and dining.')");
  }

  // Seed default fallback vocabularies
  const vocabCount = await sqliteDb.get('SELECT COUNT(*) as count FROM vocabularies');
  if (vocabCount?.count === 0) {
    await sqliteDb.run(
      'INSERT INTO vocabularies (topic_id, word, user_example, easiness, interval, repetitions, due_date) VALUES (?, ?, ?, 2.5, 0, 0, ?)',
      [1, 'algorithm', 'The software developers designed a new algorithm to sort the user database more efficiently.', new Date().toISOString()]
    );
    await sqliteDb.run(
      'INSERT INTO vocabularies (topic_id, word, user_example, easiness, interval, repetitions, due_date) VALUES (?, ?, ?, 2.5, 0, 0, ?)',
      [1, 'responsive', 'Our new web app is completely responsive, ensuring it looks beautiful on both mobile phones and wide desktop screens.', new Date().toISOString()]
    );
    await sqliteDb.run(
      'INSERT INTO vocabularies (topic_id, word, user_example, easiness, interval, repetitions, due_date) VALUES (?, ?, ?, 2.5, 0, 0, ?)',
      [2, 'synergy', 'We hope the merger will create synergy between the two marketing departments.', new Date().toISOString()]
    );
    await sqliteDb.run(
      'INSERT INTO vocabularies (topic_id, word, user_example, easiness, interval, repetitions, due_date) VALUES (?, ?, ?, 2.5, 0, 0, ?)',
      [3, 'itinerary', 'The travel agent provided us with a detailed itinerary for our 10-day trip to Japan.', new Date().toISOString()]
    );
    console.log('Seeded initial default vocabularies in SQLite.');
  }

  // Seed default fallback user
  const userCount = await sqliteDb.get('SELECT COUNT(*) as count FROM users');
  if (userCount?.count === 0) {
    await sqliteDb.run('INSERT INTO users (id, xp) VALUES (1, 0)');
    console.log('Seeded default fallback user in SQLite.');
  }
}
