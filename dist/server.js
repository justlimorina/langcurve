import express from 'express';
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
app.get('/api/stats', async (req, res) => {
    try {
        const stats = await dbAdapter.getStats();
        res.json(stats);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// 2. Get all topics
app.get('/api/topics', async (req, res) => {
    try {
        const topics = await dbAdapter.getTopics();
        res.json(topics);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// 3. Create a new topic
app.post('/api/topics', async (req, res) => {
    const { name, description } = req.body;
    if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Topic name is required.' });
    }
    try {
        const topic = await dbAdapter.createTopic(name, description);
        res.status(201).json(topic);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// 4. Get vocabulary details for a specific topic
app.get('/api/topics/:id/vocabularies', async (req, res) => {
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
        // In this production schema, we fetch definitions from MongoDB to enrich progress data
        const enrichedVocabularies = await Promise.all(vocabularies.map(async (v) => {
            const dictInfo = await dictionaryService.lookupWord(v.word);
            // Find phonetic & definition from raw payload
            let phonetic = '';
            let definition = 'No definition available.';
            let partOfSpeech = '';
            let audioUrl = '';
            if (dictInfo && dictInfo[0]) {
                const entry = dictInfo[0];
                phonetic = entry.phonetic || '';
                partOfSpeech = entry.meanings?.[0]?.partOfSpeech || '';
                definition = entry.meanings?.[0]?.definitions?.[0]?.definition || definition;
                const audioEntry = entry.phonetics?.find((p) => p.audio && p.audio !== '');
                if (audioEntry)
                    audioUrl = audioEntry.audio;
            }
            return {
                id: v.id,
                topic_id: v.topicId,
                word: v.word,
                phonetic,
                audio_url: audioUrl,
                definition,
                part_of_speech: partOfSpeech,
                user_example: v.userExample,
                easiness: v.easiness,
                interval: v.interval,
                repetitions: v.repetitions,
                dueDate: v.dueDate
            };
        }));
        res.json({ topic, vocabularies: enrichedVocabularies });
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// 5. Lookup definition and import a word
app.get('/api/dictionary/lookup', async (req, res) => {
    const word = req.query.word;
    if (!word) {
        return res.status(400).json({ error: 'Query word is required.' });
    }
    try {
        const data = await dictionaryService.lookupWord(word);
        res.json(data);
    }
    catch (error) {
        res.status(404).json({ error: error.message });
    }
});
// 6. Save imported word to database
app.post('/api/vocabularies', async (req, res) => {
    const { topic_id, word, user_example } = req.body;
    if (!topic_id || !word) {
        return res.status(400).json({ error: 'topic_id and word are required fields.' });
    }
    try {
        const topicId = parseInt(topic_id);
        const progress = await dbAdapter.upsertVocabulary(topicId, word, user_example);
        res.status(201).json(progress);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// 7. Record Spaced Repetition (SRS) Quality review feedback
app.post('/api/srs/review', async (req, res) => {
    const { word, quality } = req.body;
    if (!word || quality === undefined) {
        return res.status(400).json({ error: 'word and quality rating (0-5) are required.' });
    }
    try {
        const rating = parseInt(quality);
        if (isNaN(rating) || rating < 0 || rating > 5) {
            return res.status(400).json({ error: 'Quality score must be an integer between 0 and 5.' });
        }
        const progress = await srsService.recordReview(1, word.trim().toLowerCase(), rating);
        res.json(progress);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// 8. Get learning curve data
app.get('/api/analytics/curve', async (req, res) => {
    try {
        const dataPoints = await trackingService.getLearningCurve(1);
        res.json(dataPoints);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// 9. Update user example sentence
app.put('/api/vocabularies/:id/example', async (req, res) => {
    const vocabId = parseInt(req.params.id);
    const { user_example } = req.body;
    if (isNaN(vocabId)) {
        return res.status(400).json({ error: 'Invalid vocabulary ID.' });
    }
    try {
        const updated = await dbAdapter.updateExample(vocabId, user_example);
        res.json(updated);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// 10. Delete vocabulary progress
app.delete('/api/vocabularies/:id', async (req, res) => {
    const vocabId = parseInt(req.params.id);
    if (isNaN(vocabId)) {
        return res.status(400).json({ error: 'Invalid vocabulary ID.' });
    }
    try {
        const result = await dbAdapter.deleteVocabulary(vocabId);
        res.json(result);
    }
    catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// Catch-all route to serve the Single Page Application
app.get('*', (req, res) => {
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
    }
    catch (err) {
        console.warn('\n⚠️ Production database connection failed. Falling back to local development DBs...');
        await initializeSqliteFallback();
        console.log('🚀 LangCurve running in DEVELOPMENT_FALLBACK mode (Local SQLite, JSON File & InMemory cache).');
    }
    app.listen(PORT, () => {
        console.log(`LangCurve Server is running at http://localhost:${PORT}`);
    });
}
startServer();
