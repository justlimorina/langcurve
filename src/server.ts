import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { connectPostgres, prisma } from './config/prisma.js';
import { connectMongoDB } from './config/mongoose.js';
import { connectRedis } from './config/redis.js';
import { dbAdapter, initializeSqliteFallback } from './config/db-adapter.js';

import { DictionaryService } from './modules/dictionary/dictionary.service.js';
import { SrsService } from './modules/srs/srs.service.js';
import { TrackingService } from './modules/tracking/tracking.service.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const dictionaryService = new DictionaryService();
const srsService = new SrsService();
const trackingService = new TrackingService();

// Seed data function to ensure topics exist in PostgreSQL
async function seedDefaultTopics() {
  const count = await prisma.topic.count();
  if (count === 0) {
    await prisma.topic.createMany({
      data: [
        { name: 'Technology', description: 'Vocabulary related to computers, coding, software, and the digital world.' },
        { name: 'Business & Career', description: 'Vocabulary for professional environments, meetings, finance, and office life.' },
        { name: 'Travel & Leisure', description: 'Words and phrases for commuting, exploring new places, hotel stays, and dining.' }
      ]
    });
    console.log('Seeded initial default topics in PostgreSQL.');
  }
}

// REST API ROUTES

// 1. Get statistics
app.get('/api/stats', async (req: Request, res: Response) => {
  try {
    const stats = await dbAdapter.getStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Get all topics
app.get('/api/topics', async (req: Request, res: Response) => {
  try {
    const topics = await dbAdapter.getTopics();
    res.json(topics);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Create a new topic
app.post('/api/topics', async (req: Request, res: Response) => {
  const { name, description } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Topic name is required.' });
  }
  try {
    const topic = await dbAdapter.createTopic(name, description);
    res.status(201).json(topic);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Get vocabulary details for a specific topic
app.get('/api/topics/:id/vocabularies', async (req: Request, res: Response) => {
  const topicId = parseInt(req.params.id);
  if (isNaN(topicId)) {
    return res.status(400).json({ error: 'Invalid topic ID.' });
  }

  try {
    const topics = await dbAdapter.getTopics();
    const topic = topics.find(t => t.id === topicId);

    if (!topic) {
      return res.status(404).json({ error: 'Topic not found.' });
    }

    const vocabularies = await dbAdapter.getVocabularies(topicId);

    // Prioritize definition fields from database; perform online fallback only if empty
    const enrichedVocabularies = await Promise.all(
      vocabularies.map(async (v) => {
        let phoneticUk = v.phoneticUk || '';
        let audioUrlUk = v.audioUrlUk || '';
        let phoneticUs = v.phoneticUs || '';
        let audioUrlUs = v.audioUrlUs || '';
        let definition = v.definition || 'No definition available.';
        let partOfSpeech = v.partOfSpeech || '';

        // Fallback for old database rows lacking stored definition fields
        if (!v.definition || v.definition.trim() === '') {
          try {
            const dictInfo = await dictionaryService.lookupWord(v.word);
            if (dictInfo && dictInfo[0]) {
              const entry = dictInfo[0];
              definition = entry.meanings?.[0]?.definitions?.[0]?.definition || 'No definition available.';
              partOfSpeech = entry.meanings?.[0]?.partOfSpeech || '';
              
              const extracted = extractUkUsPhoneticsBackend(entry);
              phoneticUk = extracted.phoneticUk;
              audioUrlUk = extracted.audioUrlUk;
              phoneticUs = extracted.phoneticUs;
              audioUrlUs = extracted.audioUrlUs;
            }
          } catch (err) {
            console.warn(`Failed to fetch online fallback definition for "${v.word}":`, err);
          }
        }

        return {
          id: v.id,
          topic_id: v.topicId,
          word: v.word,
          phonetic_uk: phoneticUk,
          audio_url_uk: audioUrlUk,
          phonetic_us: phoneticUs,
          audio_url_us: audioUrlUs,
          definition,
          part_of_speech: partOfSpeech,
          user_example: v.userExample,
          easiness: v.easiness,
          interval: v.interval,
          repetitions: v.repetitions,
          dueDate: v.dueDate
        };
      })
    );

    res.json({ topic, vocabularies: enrichedVocabularies });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Lookup definition and import a word
app.get('/api/dictionary/lookup', async (req: Request, res: Response) => {
  const word = req.query.word as string;
  if (!word) {
    return res.status(400).json({ error: 'Query word is required.' });
  }

  try {
    const data = await dictionaryService.lookupWord(word);
    res.json(data);
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
});

// 6. Save imported word to database
app.post('/api/vocabularies', async (req: Request, res: Response) => {
  const { topic_id, word, user_example, definition, part_of_speech, phonetic, audio_url } = req.body;
  if (!topic_id || !word) {
    return res.status(400).json({ error: 'topic_id and word are required fields.' });
  }

  try {
    const topicId = parseInt(topic_id);
    const progress = await dbAdapter.upsertVocabulary(
      topicId,
      word,
      user_example,
      definition,
      part_of_speech,
      phonetic,
      audio_url
    );
    res.status(201).json(progress);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Record Spaced Repetition (SRS) Quality review feedback
app.post('/api/srs/review', async (req: Request, res: Response) => {
  const { word, quality, topic_id } = req.body;
  if (!word || quality === undefined) {
    return res.status(400).json({ error: 'word and quality rating (0-5) are required.' });
  }

  try {
    const rating = parseInt(quality);
    if (isNaN(rating) || rating < 0 || rating > 5) {
      return res.status(400).json({ error: 'Quality score must be an integer between 0 and 5.' });
    }

    const topicId = topic_id ? parseInt(topic_id) : 1;
    const progress = await srsService.recordReview(1, word.trim().toLowerCase(), rating, topicId);
    res.json(progress);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 8. Get learning curve data
app.get('/api/analytics/curve', async (req: Request, res: Response) => {
  try {
    const dataPoints = await trackingService.getLearningCurve(1);
    res.json(dataPoints);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 9. Update user example sentence
app.put('/api/vocabularies/:id/example', async (req: Request, res: Response) => {
  const vocabId = parseInt(req.params.id);
  const { user_example } = req.body;
  if (isNaN(vocabId)) {
    return res.status(400).json({ error: 'Invalid vocabulary ID.' });
  }

  try {
    const updated = await dbAdapter.updateExample(vocabId, user_example);
    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// 10. Delete vocabulary progress
app.delete('/api/vocabularies/:id', async (req: Request, res: Response) => {
  const vocabId = parseInt(req.params.id);
  if (isNaN(vocabId)) {
    return res.status(400).json({ error: 'Invalid vocabulary ID.' });
  }

  try {
    const result = await dbAdapter.deleteVocabulary(vocabId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Catch-all route to serve the Single Page Application
app.get('*', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Initialize Databases and Launch Server
async function startServer() {
  let connectedProd = false;
  try {
    // Attempt connections to PostgreSQL, MongoDB and Redis
    console.log('Attempting to connect to Production Databases (PostgreSQL, MongoDB, Redis)...');
    await connectPostgres();
    await connectMongoDB();
    await connectRedis();
    await seedDefaultTopics();
    connectedProd = true;
    console.log('🚀 LangCurve running in PRODUCTION mode.');
  } catch (err) {
    console.warn('\n⚠️ Production database connection failed. Falling back to local development DBs...');
    await initializeSqliteFallback();
    console.log('🚀 LangCurve running in DEVELOPMENT_FALLBACK mode (Local SQLite, JSON File & InMemory cache).');
  }

  app.listen(PORT, () => {
    console.log(`LangCurve Server is running at http://localhost:${PORT}`);
  });
}

startServer();

function extractUkUsPhoneticsBackend(dictEntry: any) {
  let phoneticUk = '';
  let audioUrlUk = '';
  let phoneticUs = '';
  let audioUrlUs = '';

  if (dictEntry && dictEntry.phonetics && dictEntry.phonetics.length > 0) {
    const uk = dictEntry.phonetics.find((p: any) => {
      const audio = (p.audio || '').toLowerCase();
      const text = (p.text || '').toLowerCase();
      return audio.includes('-uk') || audio.includes('/uk/') || text.includes('uk');
    });
    const us = dictEntry.phonetics.find((p: any) => {
      const audio = (p.audio || '').toLowerCase();
      const text = (p.text || '').toLowerCase();
      return audio.includes('-us') || audio.includes('/us/') || text.includes('us');
    });

    if (uk) {
      phoneticUk = uk.text || '';
      audioUrlUk = uk.audio || '';
    }
    if (us) {
      phoneticUs = us.text || '';
      audioUrlUs = us.audio || '';
    }

    if (!audioUrlUk && !audioUrlUs) {
      const first = dictEntry.phonetics.find((p: any) => p.audio);
      if (first) {
        audioUrlUk = first.audio;
        phoneticUk = first.text || dictEntry.phonetic || '';
        audioUrlUs = first.audio;
        phoneticUs = first.text || dictEntry.phonetic || '';
      }
    }

    if (!phoneticUk) {
      const firstText = dictEntry.phonetics.find((p: any) => p.text);
      phoneticUk = firstText ? firstText.text : (dictEntry.phonetic || '');
    }
    if (!phoneticUs) {
      phoneticUs = phoneticUk;
    }
  } else if (dictEntry) {
    phoneticUk = dictEntry.phonetic || '';
    phoneticUs = dictEntry.phonetic || '';
  }

  return { phoneticUk, audioUrlUk, phoneticUs, audioUrlUs };
}

