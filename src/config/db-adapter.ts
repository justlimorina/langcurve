import { prisma } from './prisma.js';
import { WordCache } from '../modules/dictionary/word-cache.model.js';
import { redis } from './redis.js';
import type { Database } from 'sqlite';
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
  upsertVocabulary(
    topicId: number, 
    word: string, 
    userExample?: string, 
    definition?: string, 
    partOfSpeech?: string, 
    phoneticUk?: string, 
    audioUrlUk?: string,
    phoneticUs?: string, 
    audioUrlUs?: string,
    cefrLevel?: string,
    synonyms?: string,
    antonyms?: string
  ): Promise<any>;
  updateExample(vocabId: number, userExample?: string): Promise<any>;
  deleteVocabulary(vocabId: number): Promise<any>;
  recordSrsReview(word: string, quality: number, topicId?: number): Promise<any>;
  getLearningCurve(): Promise<any[]>;
  exportData(): Promise<any>;
  importData(data: any): Promise<void>;
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
        const distinctWordsResult = await prisma.progress.findMany({
          select: { word: true },
          distinct: ['word']
        });
        const totalWords = distinctWordsResult.length;
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
    const distinctVocabsRow = await sqliteDb!.get('SELECT COUNT(DISTINCT word) as count FROM vocabularies');
    const vocabs = await sqliteDb!.all('SELECT id, user_example FROM vocabularies');
    const userRow = await sqliteDb!.get('SELECT xp FROM users WHERE id = 1');
    const examplesCount = vocabs.filter((v: any) => v.user_example && v.user_example.trim() !== '').length;
    return {
      total_topics: topics.length,
      total_words: distinctVocabsRow?.count || 0,
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
      definition: r.definition || '',
      partOfSpeech: r.part_of_speech || '',
      phoneticUk: r.phonetic_uk || null,
      audioUrlUk: r.audio_url_uk || null,
      phoneticUs: r.phonetic_us || null,
      audioUrlUs: r.audio_url_us || null,
      userExample: r.user_example,
      easiness: r.easiness || 2.5,
      interval: r.interval || 0,
      repetitions: r.repetitions || 0,
      dueDate: new Date(r.due_date || Date.now()),
      cefrLevel: r.cefr_level || null,
      synonyms: r.synonyms || null,
      antonyms: r.antonyms || null
    }));
  }

  async upsertVocabulary(
    topicId: number, 
    word: string, 
    userExample?: string,
    definition?: string,
    partOfSpeech?: string,
    phoneticUk?: string,
    audioUrlUk?: string,
    phoneticUs?: string,
    audioUrlUs?: string,
    cefrLevel?: string,
    synonyms?: string,
    antonyms?: string
  ): Promise<any> {
    if (dbMode === 'PRODUCTION') {
      try {
        return await prisma.progress.upsert({
          where: { userId_topicId_word: { userId: 1, topicId, word: word.trim().toLowerCase() } },
          update: { 
            userExample: userExample ? userExample.trim() : undefined,
            definition: definition ? definition.trim() : undefined,
            partOfSpeech: partOfSpeech ? partOfSpeech.trim() : undefined,
            phoneticUk: phoneticUk || undefined,
            audioUrlUk: audioUrlUk || undefined,
            phoneticUs: phoneticUs || undefined,
            audioUrlUs: audioUrlUs || undefined,
            cefrLevel: cefrLevel || undefined,
            synonyms: synonyms || undefined,
            antonyms: antonyms || undefined
          },
          create: { 
            userId: 1, 
            topicId, 
            word: word.trim().toLowerCase(), 
            userExample: userExample ? userExample.trim() : null,
            definition: definition ? definition.trim() : '',
            partOfSpeech: partOfSpeech ? partOfSpeech.trim() : '',
            phoneticUk: phoneticUk || null,
            audioUrlUk: audioUrlUk || null,
            phoneticUs: phoneticUs || null,
            audioUrlUs: audioUrlUs || null,
            cefrLevel: cefrLevel || null,
            synonyms: synonyms || null,
            antonyms: antonyms || null
          }
        });
      } catch (e) {
        this.fallbackToDevMode();
      }
    }
    const existing = await sqliteDb!.get('SELECT id FROM vocabularies WHERE topic_id = ? AND word = ?', [topicId, word.trim().toLowerCase()]);
    if (existing) {
      await sqliteDb!.run(
        'UPDATE vocabularies SET user_example = ?, definition = ?, part_of_speech = ?, phonetic_uk = ?, audio_url_uk = ?, phonetic_us = ?, audio_url_us = ?, cefr_level = ?, synonyms = ?, antonyms = ? WHERE id = ?',
        [
          userExample ? userExample.trim() : null,
          definition ? definition.trim() : '',
          partOfSpeech ? partOfSpeech.trim() : '',
          phoneticUk || null,
          audioUrlUk || null,
          phoneticUs || null,
          audioUrlUs || null,
          cefrLevel || null,
          synonyms || null,
          antonyms || null,
          existing.id
        ]
      );
      return { id: existing.id, topicId, word: word.trim().toLowerCase(), userExample };
    } else {
      const res = await sqliteDb!.run(
        'INSERT INTO vocabularies (topic_id, word, user_example, definition, part_of_speech, phonetic_uk, audio_url_uk, phonetic_us, audio_url_us, easiness, interval, repetitions, due_date, cefr_level, synonyms, antonyms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 2.5, 0, 0, ?, ?, ?, ?)',
        [
          topicId, 
          word.trim().toLowerCase(), 
          userExample ? userExample.trim() : null, 
          definition ? definition.trim() : '',
          partOfSpeech ? partOfSpeech.trim() : '',
          phoneticUk || null,
          audioUrlUk || null,
          phoneticUs || null,
          audioUrlUs || null,
          new Date().toISOString(),
          cefrLevel || null,
          synonyms || null,
          antonyms || null
        ]
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

  async recordSrsReview(word: string, quality: number, topicId?: number): Promise<any> {
    if (dbMode === 'PRODUCTION') {
      try {
        // Handled in SrsService using Prisma directly
        return null; 
      } catch (e) {
        this.fallbackToDevMode();
      }
    }

    const query = topicId 
      ? 'SELECT * FROM vocabularies WHERE word = ? AND topic_id = ?' 
      : 'SELECT * FROM vocabularies WHERE word = ?';
    const params = topicId ? [word.trim().toLowerCase(), topicId] : [word.trim().toLowerCase()];
    const row = await sqliteDb!.get(query, params);
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
      // Ghi nhận lịch sử ôn tập vào SQLite review_logs
      await sqliteDb!.run(
        'INSERT INTO review_logs (user_id, word, quality, easiness, interval, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [1, word.trim().toLowerCase(), quality, nextEF, nextInterval, new Date().toISOString()]
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
    // Aggregate historical logs from SQLite review_logs
    const rows = await sqliteDb!.all('SELECT created_at, quality, easiness FROM review_logs ORDER BY created_at ASC');
    const dayMap = new Map<string, { count: number; totalEF: number; correct: number; wrong: number }>();
    for (const r of rows) {
      const dateKey = new Date(r.created_at || Date.now()).toISOString().split('T')[0];
      const existing = dayMap.get(dateKey) || { count: 0, totalEF: 0, correct: 0, wrong: 0 };
      dayMap.set(dateKey, {
        count: existing.count + 1,
        totalEF: existing.totalEF + (r.easiness || 2.5),
        correct: existing.correct + (r.quality >= 3 ? 1 : 0),
        wrong: existing.wrong + (r.quality < 3 ? 1 : 0)
      });
    }
    return Array.from(dayMap.entries()).map(([date, val]) => ({
      date,
      wordCount: val.count,
      avgEasiness: parseFloat((val.totalEF / val.count).toFixed(2)),
      correctReviews: val.correct,
      wrongReviews: val.wrong
    })).sort((a, b) => a.date.localeCompare(b.date));
  }

  async exportData(): Promise<any> {
    if (dbMode === 'PRODUCTION') {
      try {
        const user = await prisma.user.findUnique({ where: { id: 1 } });
        const topics = await prisma.topic.findMany();
        const vocabularies = await prisma.progress.findMany();
        return {
          xp: user?.xp || 0,
          topics: topics.map(t => ({ id: t.id, name: t.name, description: t.description })),
          vocabularies: vocabularies.map(v => ({
            id: v.id,
            topicId: v.topicId,
            word: v.word,
            definition: v.definition,
            partOfSpeech: v.partOfSpeech,
            phoneticUk: v.phoneticUk,
            audioUrlUk: v.audioUrlUk,
            phoneticUs: v.phoneticUs,
            audioUrlUs: v.audioUrlUs,
            userExample: v.userExample,
            easiness: v.easiness,
            interval: v.interval,
            repetitions: v.repetitions,
            dueDate: v.dueDate.toISOString(),
            correctCount: v.correctCount,
            wrongCount: v.wrongCount,
            cefrLevel: v.cefrLevel,
            synonyms: v.synonyms,
            antonyms: v.antonyms
          }))
        };
      } catch (e) {
        this.fallbackToDevMode();
      }
    }
    const userRow = await sqliteDb!.get('SELECT xp FROM users WHERE id = 1');
    const topics = await sqliteDb!.all('SELECT * FROM topics');
    const vocabs = await sqliteDb!.all('SELECT * FROM vocabularies');
    return {
      xp: userRow?.xp || 0,
      topics: topics.map((t: any) => ({ id: t.id, name: t.name, description: t.description })),
      vocabularies: vocabs.map((v: any) => ({
        id: v.id,
        topicId: v.topic_id,
        word: v.word,
        definition: v.definition || '',
        partOfSpeech: v.part_of_speech || '',
        phoneticUk: v.phonetic_uk || null,
        audioUrlUk: v.audio_url_uk || null,
        phoneticUs: v.phonetic_us || null,
        audioUrlUs: v.audio_url_us || null,
        userExample: v.user_example,
        easiness: v.easiness || 2.5,
        interval: v.interval || 0,
        repetitions: v.repetitions || 0,
        dueDate: new Date(v.due_date || Date.now()).toISOString(),
        cefrLevel: v.cefr_level || null,
        synonyms: v.synonyms || null,
        antonyms: v.antonyms || null
      }))
    };
  }

  async importData(data: any): Promise<void> {
    const { xp, topics, vocabularies } = data;
    
    if (dbMode === 'PRODUCTION') {
      try {
        await prisma.$transaction([
          prisma.progress.deleteMany(),
          prisma.topic.deleteMany(),
          prisma.reviewLog.deleteMany()
        ]);
        
        await prisma.user.upsert({
          where: { id: 1 },
          update: { xp: xp || 0 },
          create: { id: 1, email: 'user@langcurve.com', password: 'no-password', xp: xp || 0 }
        });

        const topicIdMap = new Map<number, number>();
        for (const topic of topics) {
          const createdTopic = await prisma.topic.create({
            data: { name: topic.name, description: topic.description }
          });
          topicIdMap.set(topic.id, createdTopic.id);
        }

        for (const v of vocabularies) {
          const newTopicId = topicIdMap.get(v.topicId);
          if (!newTopicId) continue;
          await prisma.progress.create({
            data: {
              userId: 1,
              topicId: newTopicId,
              word: v.word,
              definition: v.definition || '',
              partOfSpeech: v.partOfSpeech || '',
              phoneticUk: v.phoneticUk || null,
              audioUrlUk: v.audioUrlUk || null,
              phoneticUs: v.phoneticUs || null,
              audioUrlUs: v.audioUrlUs || null,
              userExample: v.userExample || null,
              easiness: v.easiness || 2.5,
              interval: v.interval || 0,
              repetitions: v.repetitions || 0,
              dueDate: new Date(v.dueDate || Date.now()),
              correctCount: v.correctCount || 0,
              wrongCount: v.wrongCount || 0,
              cefrLevel: v.cefrLevel || null,
              synonyms: v.synonyms || null,
              antonyms: v.antonyms || null
            }
          });
        }
        return;
      } catch (e) {
        this.fallbackToDevMode();
      }
    }
    
    await sqliteDb!.run('DELETE FROM vocabularies');
    await sqliteDb!.run('DELETE FROM topics');
    await sqliteDb!.run('DELETE FROM review_logs');
    
    await sqliteDb!.run('INSERT OR REPLACE INTO users (id, xp) VALUES (1, ?)', [xp || 0]);
    
    const topicIdMap = new Map<number, number>();
    for (const topic of topics) {
      const res = await sqliteDb!.run(
        'INSERT INTO topics (name, description) VALUES (?, ?)',
        [topic.name, topic.description || null]
      );
      topicIdMap.set(topic.id, res.lastID!);
    }
    
    for (const v of vocabularies) {
      const newTopicId = topicIdMap.get(v.topicId);
      if (!newTopicId) continue;
      await sqliteDb!.run(
        'INSERT INTO vocabularies (topic_id, word, definition, part_of_speech, phonetic_uk, audio_url_uk, phonetic_us, audio_url_us, user_example, easiness, interval, repetitions, due_date, cefr_level, synonyms, antonyms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          newTopicId,
          v.word,
          v.definition || '',
          v.partOfSpeech || '',
          v.phoneticUk || null,
          v.audioUrlUk || null,
          v.phoneticUs || null,
          v.audioUrlUs || null,
          v.userExample || null,
          v.easiness || 2.5,
          v.interval || 0,
          v.repetitions || 0,
          new Date(v.dueDate || Date.now()).toISOString(),
          v.cefrLevel || null,
          v.synonyms || null,
          v.antonyms || null
        ]
      );
    }
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
  const sqlite3 = (await import('sqlite3')).default;
  const { open } = await import('sqlite');

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
      word TEXT,
      definition TEXT DEFAULT '',
      part_of_speech TEXT DEFAULT '',
      phonetic_uk TEXT,
      audio_url_uk TEXT,
      phonetic_us TEXT,
      audio_url_us TEXT,
      user_example TEXT,
      easiness REAL DEFAULT 2.5,
      interval INTEGER DEFAULT 0,
      repetitions INTEGER DEFAULT 0,
      due_date TEXT,
      cefr_level TEXT,
      synonyms TEXT,
      antonyms TEXT,
      UNIQUE(topic_id, word)
    );
    CREATE TABLE IF NOT EXISTS review_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      word TEXT,
      quality INTEGER,
      easiness REAL,
      interval INTEGER,
      created_at TEXT
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      xp INTEGER DEFAULT 0
    );
  `);

  // Schema check & upgrade for cefr_level, synonyms, antonyms and review_logs table
  try {
    const tableInfo = await sqliteDb.all("PRAGMA table_info(vocabularies)");
    const hasCefr = tableInfo.some((col: any) => col.name === 'cefr_level');
    if (!hasCefr) {
      console.log('Migrating SQLite database schema to support CEFR level, synonyms, and antonyms...');
      await sqliteDb.exec(`
        ALTER TABLE vocabularies ADD COLUMN cefr_level TEXT;
        ALTER TABLE vocabularies ADD COLUMN synonyms TEXT;
        ALTER TABLE vocabularies ADD COLUMN antonyms TEXT;
      `);
      console.log('SQLite database schema migration for CEFR and synonyms/antonyms completed successfully.');
    }
  } catch (e) {
    console.error('Failed to verify or upgrade SQLite schema for CEFR/synonyms/antonyms:', e);
  }

  // Schema check & upgrade for existing databases to support UK/US dialect pronunciations
  try {
    const tableInfo = await sqliteDb.all("PRAGMA table_info(vocabularies)");
    const hasPhoneticUk = tableInfo.some((col: any) => col.name === 'phonetic_uk');
    if (!hasPhoneticUk) {
      console.log('Migrating SQLite database schema to support UK/US phonetic & audio...');
      const hasOldPhonetic = tableInfo.some((col: any) => col.name === 'phonetic');
      
      await sqliteDb.exec(`
        ALTER TABLE vocabularies RENAME TO vocabularies_old;
        
        CREATE TABLE vocabularies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          topic_id INTEGER,
          word TEXT,
          definition TEXT DEFAULT '',
          part_of_speech TEXT DEFAULT '',
          phonetic_uk TEXT,
          audio_url_uk TEXT,
          phonetic_us TEXT,
          audio_url_us TEXT,
          user_example TEXT,
          easiness REAL DEFAULT 2.5,
          interval INTEGER DEFAULT 0,
          repetitions INTEGER DEFAULT 0,
          due_date TEXT,
          UNIQUE(topic_id, word)
        );
      `);

      if (hasOldPhonetic) {
        await sqliteDb.exec(`
          INSERT INTO vocabularies (id, topic_id, word, definition, part_of_speech, user_example, easiness, interval, repetitions, due_date, phonetic_uk, audio_url_uk, phonetic_us, audio_url_us)
          SELECT id, topic_id, word, definition, part_of_speech, user_example, easiness, interval, repetitions, due_date, phonetic, audio_url, '', '' FROM vocabularies_old;
        `);
      } else {
        await sqliteDb.exec(`
          INSERT INTO vocabularies (id, topic_id, word, definition, part_of_speech, user_example, easiness, interval, repetitions, due_date, phonetic_uk, audio_url_uk, phonetic_us, audio_url_us)
          SELECT id, topic_id, word, definition, part_of_speech, user_example, easiness, interval, repetitions, due_date, '', '', '', '' FROM vocabularies_old;
        `);
      }
      
      await sqliteDb.exec(`DROP TABLE vocabularies_old;`);
      console.log('SQLite database schema migration for UK/US columns completed successfully.');
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
