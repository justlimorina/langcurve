import { cacheAdapter, docStoreAdapter } from '../../config/db-adapter.js';
import dotenv from 'dotenv';

dotenv.config();

export class DictionaryService {
  /**
   * Morphological analyzer (Lemmatizer) to extract root word
   */
  public lemmatize(word: string): string {
    const clean = word.trim().toLowerCase();
    if (clean.length <= 2) return clean;

    // Simple rule-based lemmatizer for base cases (lemma)
    if (clean.endsWith('ies') && !clean.endsWith('aies') && !clean.endsWith('eies')) {
      return clean.slice(0, -3) + 'y'; // studies -> study
    }
    if (clean.endsWith('ied')) {
      return clean.slice(0, -3) + 'y'; // studied -> study
    }
    if (clean.endsWith('ing')) {
      // e.g. running -> run (double consonant), coding -> code, reading -> read
      const base = clean.slice(0, -3);
      if (base.endsWith('cod') || base.endsWith('mak') || base.endsWith('writ') || base.endsWith('us')) {
        return base + 'e'; // coding -> code
      }
      // check double consonants: e.g. running -> run
      if (base.length > 2 && base[base.length - 1] === base[base.length - 2]) {
        return base.slice(0, -1);
      }
      return base;
    }
    if (clean.endsWith('ed')) {
      const base = clean.slice(0, -2);
      if (base.endsWith('d') || base.endsWith('t')) {
        return base; // wanted -> want
      }
      if (clean.endsWith('ied')) {
        return base.slice(0, -1) + 'y';
      }
      // e.g. created -> create
      if (base.endsWith('creat') || base.endsWith('us') || base.endsWith('lik')) {
        return base + 'e';
      }
      return base;
    }
    if (clean.endsWith('s') && !clean.endsWith('ss') && !clean.endsWith('us') && !clean.endsWith('is')) {
      if (clean.endsWith('es')) {
        // e.g. boxes -> box, matches -> match
        if (clean.endsWith('boxes') || clean.endsWith('classes') || clean.endsWith('matches')) {
          return clean.slice(0, -2);
        }
        return clean.slice(0, -1);
      }
      return clean.slice(0, -1); // algorithms -> algorithm
    }

    return clean;
  }

  /**
   * Primary entry point to look up a word with Caching and API Fallback mechanics
   */
  public async lookupWord(word: string): Promise<any> {
    const lemma = this.lemmatize(word);
    const cacheKey = `word:${lemma}`;

    // 1. Redis cache lookup for high performance (<50ms)
    try {
      const cached = await cacheAdapter.get(cacheKey);
      if (cached) {
        console.log(`[Cache Hit] Redis: ${lemma}`);
        return JSON.parse(cached);
      }
    } catch (e) {
      console.warn('Redis read error:', e);
    }

    // 2. MongoDB local database lookup (Offline storage)
    const localDbMatch = await docStoreAdapter.findWord(lemma);
    if (localDbMatch) {
      console.log(`[Cache Hit] MongoDB: ${lemma}`);
      try {
        await cacheAdapter.set(cacheKey, JSON.stringify(localDbMatch), { EX: 604800 }); // Cache 7 days
      } catch (e) {
        console.warn('Redis write error:', e);
      }
      return localDbMatch;
    }

    // 3. Fallback Dictionary API Calls
    console.log(`[Cache Miss] API Fetch: ${lemma}`);
    let resultPayload: any = null;
    let apiSource = '';

    // Enriched Free Dictionary API (Main free source)
    try {
      resultPayload = await this.fetchEnrichedFreeDictionary(lemma);
      apiSource = 'freedictionary-enriched';
      console.log(`[API Fetch Success] Enriched Free Dictionary: ${lemma}`);
    } catch (error) {
      console.warn('Enriched Free Dictionary failed, trying next fallback...', error);
    }

    // Oxford Dictionary API
    if (!resultPayload && process.env.OXFORD_APP_ID && process.env.OXFORD_APP_KEY) {
      try {
        resultPayload = await this.fetchFromOxford(lemma);
        apiSource = 'oxford';
      } catch (error) {
        console.error('Oxford API Call failed, trying next fallback...', error);
      }
    }

    // Cambridge Dictionary API
    if (!resultPayload && process.env.CAMBRIDGE_API_KEY) {
      try {
        resultPayload = await this.fetchFromCambridge(lemma);
        apiSource = 'cambridge';
      } catch (error) {
        console.error('Cambridge API Call failed, trying next fallback...', error);
      }
    }

    // Public Free Dictionary API (Raw fallback if enrichment had issues)
    if (!resultPayload) {
      try {
        resultPayload = await this.fetchFromFreeDictionary(lemma);
        apiSource = 'freedictionary';
        console.log(`[API Fetch Success] Free Dictionary API (Raw): ${lemma}`);
      } catch (error) {
        console.error('Free Dictionary API Call failed, trying next fallback...', error);
      }
    }

    // Google Translate TTS Fallback (Absolute fallback)
    if (!resultPayload) {
      try {
        resultPayload = this.fetchFromGoogleTTS(lemma);
        apiSource = 'google-tts';
        console.log(`[API Fetch Success] Google TTS Fallback: ${lemma}`);
      } catch (error) {
        console.error('Google TTS Fallback failed.', error);
        throw new Error(`Word "${word}" definition could not be resolved from any dictionary APIs.`);
      }
    }

    // 4. Save to cache layers
    if (resultPayload) {
      if (Array.isArray(resultPayload) && resultPayload[0]) {
        const entry = resultPayload[0];
        if (!entry.cefrLevel) {
          entry.cefrLevel = this.classifyCefr(lemma);
        }
        if (entry.synonyms === undefined || entry.antonyms === undefined) {
          const synonymsList: string[] = [];
          const antonymsList: string[] = [];
          if (Array.isArray(entry.meanings)) {
            for (const m of entry.meanings) {
              if (Array.isArray(m.synonyms)) synonymsList.push(...m.synonyms);
              if (Array.isArray(m.antonyms)) antonymsList.push(...m.antonyms);
              if (Array.isArray(m.definitions)) {
                for (const d of m.definitions) {
                  if (Array.isArray(d.synonyms)) synonymsList.push(...d.synonyms);
                  if (Array.isArray(d.antonyms)) antonymsList.push(...d.antonyms);
                }
              }
            }
          }
          entry.synonyms = [...new Set(synonymsList)].slice(0, 10).join(', ');
          entry.antonyms = [...new Set(antonymsList)].slice(0, 10).join(', ');
        }
      }

      try {
        // Save to MongoDB
        await docStoreAdapter.saveWord(lemma, apiSource, resultPayload);
        
        // Save to Redis (Expires in 7 days)
        await cacheAdapter.set(cacheKey, JSON.stringify(resultPayload), { EX: 604800 });
      } catch (e) {
        console.warn('Cache write error:', e);
      }
    }

    return resultPayload;
  }

  private async fetchEnrichedFreeDictionary(lemma: string): Promise<any> {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${lemma}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Free Dictionary API error status ${response.status}`);
    
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Invalid response from Free Dictionary API');
    }

    const entry = data[0];
    let phoneticUk = '';
    let audioUrlUk = '';
    let phoneticUs = '';
    let audioUrlUs = '';

    if (entry.phonetics && entry.phonetics.length > 0) {
      const ukPhonetic = entry.phonetics.find((p: any) => {
        const audioUrl = (p.audio || '').toLowerCase();
        const textVal = (p.text || '').toLowerCase();
        return audioUrl.includes('-uk') || audioUrl.includes('/uk/') || textVal.includes('uk');
      });
      const usPhonetic = entry.phonetics.find((p: any) => {
        const audioUrl = (p.audio || '').toLowerCase();
        const textVal = (p.text || '').toLowerCase();
        return audioUrl.includes('-us') || audioUrl.includes('/us/') || textVal.includes('us');
      });

      if (ukPhonetic) {
        phoneticUk = ukPhonetic.text || '';
        audioUrlUk = ukPhonetic.audio || '';
      }
      if (usPhonetic) {
        phoneticUs = usPhonetic.text || '';
        audioUrlUs = usPhonetic.audio || '';
      }

      // If one is missing, try to find another phonetic card with text to fill the other slot
      if (ukPhonetic && !usPhonetic) {
        const other = entry.phonetics.find((p: any) => p !== ukPhonetic && p.text);
        if (other) {
          phoneticUs = other.text || '';
          audioUrlUs = other.audio || '';
        }
      } else if (usPhonetic && !ukPhonetic) {
        const other = entry.phonetics.find((p: any) => p !== usPhonetic && p.text);
        if (other) {
          phoneticUk = other.text || '';
          audioUrlUk = other.audio || '';
        }
      }

      // If still no audio, get first available
      if (!audioUrlUk && !audioUrlUs) {
        const firstWithAudio = entry.phonetics.find((p: any) => p.audio);
        if (firstWithAudio) {
          audioUrlUk = firstWithAudio.audio;
          audioUrlUs = firstWithAudio.audio;
        }
      }

      // Fill in text
      if (!phoneticUk) {
        const firstWithText = entry.phonetics.find((p: any) => p.text);
        phoneticUk = firstWithText ? firstWithText.text : (entry.phonetic || '');
      }
      if (!phoneticUs) {
        const secondWithText = entry.phonetics.find((p: any) => p.text && p.text !== phoneticUk);
        phoneticUs = secondWithText ? secondWithText.text : phoneticUk;
      }
    }

    // Google TTS Fallback for missing audio urls (append ?dialect=-uk/-us to match backend/frontend regex)
    if (!audioUrlUk) {
      audioUrlUk = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en-GB&client=tw-ob&q=${encodeURIComponent(lemma)}?dialect=-uk`;
    } else if (!audioUrlUk.includes('dialect=')) {
      audioUrlUk = audioUrlUk + (audioUrlUk.includes('?') ? '&' : '?') + 'dialect=-uk';
    }

    if (!audioUrlUs) {
      audioUrlUs = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en-US&client=tw-ob&q=${encodeURIComponent(lemma)}?dialect=-us`;
    } else if (!audioUrlUs.includes('dialect=')) {
      audioUrlUs = audioUrlUs + (audioUrlUs.includes('?') ? '&' : '?') + 'dialect=-us';
    }

    // Standardize the phonetics array for frontend compatibility
    entry.phonetics = [
      { text: phoneticUk, audio: audioUrlUk },
      { text: phoneticUs, audio: audioUrlUs }
    ];
    entry.phonetic = phoneticUk || phoneticUs || entry.phonetic || '';

    return [entry];
  }

  private fetchFromGoogleTTS(lemma: string): any {
    return [
      {
        word: lemma,
        phonetics: [
          {
            text: '/uk/',
            audio: `https://translate.google.com/translate_tts?ie=UTF-8&tl=en-GB&client=tw-ob&q=${encodeURIComponent(lemma)}?dialect=-uk`
          },
          {
            text: '/us/',
            audio: `https://translate.google.com/translate_tts?ie=UTF-8&tl=en-US&client=tw-ob&q=${encodeURIComponent(lemma)}?dialect=-us`
          }
        ],
        meanings: [
          {
            partOfSpeech: 'vocabulary',
            definitions: [
              {
                definition: 'No definition available. (Google TTS fallback)',
                example: ''
              }
            ]
          }
        ],
        source: 'google-tts',
        cefrLevel: this.classifyCefr(lemma),
        synonyms: '',
        antonyms: ''
      }
    ];
  }

  private async fetchFromOxford(lemma: string): Promise<any> {
    const url = `https://od-api.oxforddictionaries.com/api/v2/entries/en-gb/${lemma}`;
    const response = await fetch(url, {
      headers: {
        'app_id': process.env.OXFORD_APP_ID || '',
        'app_key': process.env.OXFORD_APP_KEY || ''
      }
    });
    if (!response.ok) throw new Error(`Oxford API error status ${response.status}`);
    return await response.json();
  }

  private async fetchFromCambridge(lemma: string): Promise<any> {
    const url = `https://api.dictionary.cambridge.org/api/v1/dictionaries/english/entries/${lemma}`;
    const response = await fetch(url, {
      headers: {
        'accessKey': process.env.CAMBRIDGE_API_KEY || ''
      }
    });
    if (!response.ok) throw new Error(`Cambridge API error status ${response.status}`);
    return await response.json();
  }

  private async fetchFromFreeDictionary(lemma: string): Promise<any> {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${lemma}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Free Dictionary API error status ${response.status}`);
    return await response.json();
  }

  private classifyCefr(word: string): string {
    const clean = word.toLowerCase().trim();
    
    // Static lists of common words for representative CEFR classification
    const a1 = new Set(['be', 'have', 'do', 'say', 'go', 'get', 'make', 'know', 'think', 'take', 'see', 'come', 'want', 'look', 'use', 'find', 'give', 'tell', 'work', 'call', 'try', 'ask', 'need', 'feel', 'become', 'leave', 'put', 'mean', 'keep', 'let', 'begin', 'seem', 'help', 'talk', 'turn', 'start', 'show', 'hear', 'play', 'run', 'move', 'like', 'live', 'believe', 'hold', 'bring', 'write', 'provide', 'sit', 'stand', 'lose', 'pay', 'meet', 'include', 'continue', 'set', 'learn', 'change', 'lead', 'understand', 'watch', 'follow', 'stop', 'create', 'speak', 'read', 'allow', 'add', 'spend', 'grow', 'open', 'walk', 'win', 'offer', 'love', 'remember', 'consider', 'appear', 'buy', 'wait', 'serve', 'die', 'send', 'expect', 'build', 'stay', 'fall', 'cut', 'reach', 'kill', 'remain', 'hello', 'good', 'bad', 'happy', 'sad', 'english', 'book', 'time', 'day', 'year', 'water']);
    const a2 = new Set(['study', 'travel', 'prepare', 'finish', 'decide', 'arrive', 'explain', 'suggest', 'receive', 'discuss', 'contain', 'design', 'manage', 'improve', 'develop', 'require', 'product', 'program', 'project', 'client', 'career', 'office', 'meeting', 'finance', 'hotel', 'flight', 'dinner', 'lunch', 'breakfast', 'ticket', 'station', 'airport', 'holiday', 'museum', 'weather', 'winter', 'summer', 'autumn', 'spring', 'family', 'friend', 'sister', 'brother', 'mother', 'father', 'house', 'apartment']);
    const b1 = new Set(['algorithm', 'responsive', 'synergy', 'itinerary', 'achieve', 'benefit', 'challenge', 'compare', 'confirm', 'discover', 'encourage', 'establish', 'focus', 'identify', 'imagine', 'intend', 'measure', 'observe', 'prevent', 'realize', 'reduce', 'reflect', 'remove', 'replace', 'satisfy', 'solve', 'structure', 'support', 'trust', 'value', 'career', 'culture', 'economy', 'education', 'environment', 'health', 'industry', 'opinion', 'politics', 'society', 'technology']);
    const b2 = new Set(['collaborate', 'innovate', 'optimize', 'specialize', 'implement', 'integrate', 'evaluate', 'coordinate', 'negotiate', 'transform', 'advocate', 'facilitate', 'generate', 'simulate', 'sustain', 'validate', 'diversity', 'framework', 'infrastructure', 'strategy', 'dynamic', 'perspective', 'significant', 'alternative', 'efficient', 'flexible', 'sustainable']);
    const c1 = new Set(['detriment', 'ubiquitous', 'meticulous', 'anomaly', 'paradigm', 'empirical', 'cognitive', 'scrutinize', 'ameliorate', 'equivocal', 'lucid', 'precarious', 'superfluous', 'transient', 'ephemeral', 'aesthetic', 'pragmatic', 'resolute', 'tenacious', 'vulnerable', 'conundrum', 'discrepancy', 'implication', 'predecessor', 'subsequent']);
    const c2 = new Set(['exacerbate', 'obsolescence', 'juxtaposition', 'cacophony', 'epiphany', 'surreptitious', 'fastidious', 'quintessential', 'capricious', 'nefarious', 'recalcitrant', 'sycophant', 'ubiquity', 'paradoxical', 'idiosyncrasy', 'indefatigable', 'mellifluous', 'panacea', 'serendipity', 'zenith']);

    if (a1.has(clean)) return 'A1';
    if (a2.has(clean)) return 'A2';
    if (b1.has(clean)) return 'B1';
    if (b2.has(clean)) return 'B2';
    if (c1.has(clean)) return 'C1';
    if (c2.has(clean)) return 'C2';

    // Simple length & suffix fallback rules if not in static list
    if (clean.length <= 4) return 'A2';
    if (clean.length <= 6) return 'B1';
    if (clean.length <= 8) return 'B2';
    if (clean.length <= 11) return 'C1';
    return 'C2';
  }
}
