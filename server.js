import express from 'express';
import { initDB, getDb } from './database.js';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 3000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API Routes

// 1. Get stats
app.get('/api/stats', async (req, res) => {
  try {
    const db = await getDb();
    const stats = await db.get(`
      SELECT 
        (SELECT COUNT(*) FROM topics) as total_topics,
        (SELECT COUNT(*) FROM vocabularies) as total_words,
        (SELECT COUNT(*) FROM vocabularies WHERE user_example IS NOT NULL AND user_example != '') as total_examples
    `);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Get all topics with word counts
app.get('/api/topics', async (req, res) => {
  try {
    const db = await getDb();
    const topics = await db.all(`
      SELECT t.*, COUNT(v.id) as word_count 
      FROM topics t 
      LEFT JOIN vocabularies v ON t.id = v.topic_id 
      GROUP BY t.id
      ORDER BY t.name ASC
    `);
    res.json(topics);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Create a topic
app.post('/api/topics', async (req, res) => {
  const { name, description } = req.body;
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'Topic name is required.' });
  }
  try {
    const db = await getDb();
    const result = await db.run(
      'INSERT INTO topics (name, description) VALUES (?, ?)',
      name.trim(),
      description ? description.trim() : null
    );
    res.status(201).json({ id: result.lastID, name: name.trim(), description });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'A topic with this name already exists.' });
    }
    res.status(500).json({ error: error.message });
  }
});

// 4. Get vocabularies in a topic
app.get('/api/topics/:id/vocabularies', async (req, res) => {
  const topicId = req.params.id;
  try {
    const db = await getDb();
    const topic = await db.get('SELECT * FROM topics WHERE id = ?', topicId);
    if (!topic) {
      return res.status(404).json({ error: 'Topic not found.' });
    }
    const vocabularies = await db.all(
      'SELECT * FROM vocabularies WHERE topic_id = ? ORDER BY created_at DESC',
      topicId
    );
    res.json({ topic, vocabularies });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Add vocabulary
app.post('/api/vocabularies', async (req, res) => {
  const { topic_id, word, phonetic, audio_url, definition, part_of_speech, user_example } = req.body;
  if (!topic_id || !word || !definition) {
    return res.status(400).json({ error: 'topic_id, word, and definition are required fields.' });
  }
  try {
    const db = await getDb();
    const topic = await db.get('SELECT id FROM topics WHERE id = ?', topic_id);
    if (!topic) {
      return res.status(404).json({ error: 'Topic not found.' });
    }
    
    const result = await db.run(
      `INSERT INTO vocabularies (topic_id, word, phonetic, audio_url, definition, part_of_speech, user_example)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      topic_id,
      word.trim(),
      phonetic ? phonetic.trim() : null,
      audio_url ? audio_url.trim() : null,
      definition.trim(),
      part_of_speech ? part_of_speech.trim() : null,
      user_example ? user_example.trim() : null
    );
    
    res.status(201).json({
      id: result.lastID,
      topic_id,
      word: word.trim(),
      phonetic,
      audio_url,
      definition,
      part_of_speech,
      user_example
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Update user example sentence
app.put('/api/vocabularies/:id/example', async (req, res) => {
  const vocabId = req.params.id;
  const { user_example } = req.body;
  try {
    const db = await getDb();
    const vocab = await db.get('SELECT id FROM vocabularies WHERE id = ?', vocabId);
    if (!vocab) {
      return res.status(404).json({ error: 'Vocabulary word not found.' });
    }
    await db.run(
      'UPDATE vocabularies SET user_example = ? WHERE id = ?',
      user_example ? user_example.trim() : null,
      vocabId
    );
    res.json({ id: vocabId, user_example: user_example ? user_example.trim() : null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Delete vocabulary
app.delete('/api/vocabularies/:id', async (req, res) => {
  const vocabId = req.params.id;
  try {
    const db = await getDb();
    const vocab = await db.get('SELECT id FROM vocabularies WHERE id = ?', vocabId);
    if (!vocab) {
      return res.status(404).json({ error: 'Vocabulary word not found.' });
    }
    await db.run('DELETE FROM vocabularies WHERE id = ?', vocabId);
    res.json({ message: 'Vocabulary word deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Catch-all route to serve the Single Page Application for frontend client routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Initialize DB before starting server
initDB().then(() => {
  console.log('Database initialized successfully.');
  app.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
