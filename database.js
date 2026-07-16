import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, 'langcurve.db');

let db;

export async function getDb() {
  if (!db) {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database
    });
  }
  return db;
}

export async function initDB() {
  const db = await getDb();
  
  // Enable foreign keys
  await db.run('PRAGMA foreign_keys = ON;');
  
  // Create topics table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  
  // Create vocabularies table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS vocabularies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER NOT NULL,
      word TEXT NOT NULL,
      phonetic TEXT,
      audio_url TEXT,
      definition TEXT NOT NULL,
      part_of_speech TEXT,
      user_example TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (topic_id) REFERENCES topics (id) ON DELETE CASCADE
    );
  `);

  // Check if topics are empty to seed initial data
  const topicCount = await db.get('SELECT COUNT(*) as count FROM topics');
  if (topicCount.count === 0) {
    const techResult = await db.run(
      'INSERT INTO topics (name, description) VALUES (?, ?)',
      'Technology',
      'Vocabulary related to computers, coding, software, and the digital world.'
    );
    const bizResult = await db.run(
      'INSERT INTO topics (name, description) VALUES (?, ?)',
      'Business & Career',
      'Vocabulary for professional environments, meetings, finance, and office life.'
    );
    const travelResult = await db.run(
      'INSERT INTO topics (name, description) VALUES (?, ?)',
      'Travel & Leisure',
      'Words and phrases for commuting, exploring new places, hotel stays, and dining.'
    );

    // Seed some initial vocabularies
    // For Technology: "algorithm", "responsive"
    await db.run(
      `INSERT INTO vocabularies (topic_id, word, phonetic, audio_url, definition, part_of_speech, user_example)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      techResult.lastID,
      'algorithm',
      '/ˈæl.ɡə.rɪ.ðəm/',
      'https://api.dictionaryapi.dev/media/pronunciations/en/algorithm-us.mp3',
      'A process or set of rules to be followed in calculations or other problem-solving operations, especially by a computer.',
      'noun',
      'The software developers designed a new algorithm to sort the user database more efficiently.'
    );
    
    await db.run(
      `INSERT INTO vocabularies (topic_id, word, phonetic, audio_url, definition, part_of_speech, user_example)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      techResult.lastID,
      'responsive',
      '/rɪˈspɒnsɪv/',
      'https://api.dictionaryapi.dev/media/pronunciations/en/responsive-us.mp3',
      'Responding readily and warmly to appreciation, influence, or suggestion; (of a website) designed to adjust smoothly to different screen sizes.',
      'adjective',
      'Our new web app is completely responsive, ensuring it looks beautiful on both mobile phones and wide desktop screens.'
    );

    // For Business: "synergy"
    await db.run(
      `INSERT INTO vocabularies (topic_id, word, phonetic, audio_url, definition, part_of_speech, user_example)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      bizResult.lastID,
      'synergy',
      '/ˈsɪn.ə.dʒi/',
      'https://api.dictionaryapi.dev/media/pronunciations/en/synergy-us.mp3',
      'The interaction or cooperation of two or more organizations, substances, or other agents to produce a combined effect greater than the sum of their separate effects.',
      'noun',
      'We hope the merger will create synergy between the two marketing departments.'
    );

    // For Travel: "itinerary"
    await db.run(
      `INSERT INTO vocabularies (topic_id, word, phonetic, audio_url, definition, part_of_speech, user_example)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      travelResult.lastID,
      'itinerary',
      '/aɪˈtɪn.ər.ər.i/',
      'https://api.dictionaryapi.dev/media/pronunciations/en/itinerary-us.mp3',
      'A detailed plan for a journey, especially a list of places to visit and plans for travel.',
      'noun',
      'The travel agent provided us with a detailed itinerary for our 10-day trip to Japan.'
    );
  }
}
