import { cacheAdapter, docStoreAdapter } from '../../config/db-adapter.js';
import dotenv from 'dotenv';
dotenv.config();
export class DictionaryService {
    /**
     * Morphological analyzer (Lemmatizer) to extract root word
     */
    lemmatize(word) {
        const clean = word.trim().toLowerCase();
        if (clean.length <= 2)
            return clean;
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
    async lookupWord(word) {
        const lemma = this.lemmatize(word);
        const cacheKey = `word:${lemma}`;
        // 1. Redis cache lookup for high performance (<50ms)
        try {
            const cached = await cacheAdapter.get(cacheKey);
            if (cached) {
                console.log(`[Cache Hit] Redis: ${lemma}`);
                return JSON.parse(cached);
            }
        }
        catch (e) {
            console.warn('Redis read error:', e);
        }
        // 2. MongoDB local database lookup (Offline storage)
        const localDbMatch = await docStoreAdapter.findWord(lemma);
        if (localDbMatch) {
            console.log(`[Cache Hit] MongoDB: ${lemma}`);
            try {
                await cacheAdapter.set(cacheKey, JSON.stringify(localDbMatch), { EX: 604800 }); // Cache 7 days
            }
            catch (e) {
                console.warn('Redis write error:', e);
            }
            return localDbMatch;
        }
        // 3. Fallback Dictionary API Calls
        console.log(`[Cache Miss] API Fetch: ${lemma}`);
        let resultPayload = null;
        let apiSource = '';
        // Oxford Dictionary API
        if (process.env.OXFORD_APP_ID && process.env.OXFORD_APP_KEY) {
            try {
                resultPayload = await this.fetchFromOxford(lemma);
                apiSource = 'oxford';
            }
            catch (error) {
                console.error('Oxford API Call failed, trying next fallback...', error);
            }
        }
        // Cambridge Dictionary API
        if (!resultPayload && process.env.CAMBRIDGE_API_KEY) {
            try {
                resultPayload = await this.fetchFromCambridge(lemma);
                apiSource = 'cambridge';
            }
            catch (error) {
                console.error('Cambridge API Call failed, trying next fallback...', error);
            }
        }
        // Public Free Dictionary API (Absolute fallback for zero-keys development)
        if (!resultPayload) {
            try {
                resultPayload = await this.fetchFromFreeDictionary(lemma);
                apiSource = 'freedictionary';
            }
            catch (error) {
                console.error('Free Dictionary API Call failed.', error);
                throw new Error(`Word "${word}" definition could not be resolved from any dictionary APIs.`);
            }
        }
        // 4. Save to cache layers
        if (resultPayload) {
            try {
                // Save to MongoDB
                await docStoreAdapter.saveWord(lemma, apiSource, resultPayload);
                // Save to Redis (Expires in 7 days)
                await cacheAdapter.set(cacheKey, JSON.stringify(resultPayload), { EX: 604800 });
            }
            catch (e) {
                console.warn('Cache write error:', e);
            }
        }
        return resultPayload;
    }
    async fetchFromOxford(lemma) {
        const url = `https://od-api.oxforddictionaries.com/api/v2/entries/en-gb/${lemma}`;
        const response = await fetch(url, {
            headers: {
                'app_id': process.env.OXFORD_APP_ID || '',
                'app_key': process.env.OXFORD_APP_KEY || ''
            }
        });
        if (!response.ok)
            throw new Error(`Oxford API error status ${response.status}`);
        return await response.json();
    }
    async fetchFromCambridge(lemma) {
        const url = `https://api.dictionary.cambridge.org/api/v1/dictionaries/english/entries/${lemma}`;
        const response = await fetch(url, {
            headers: {
                'accessKey': process.env.CAMBRIDGE_API_KEY || ''
            }
        });
        if (!response.ok)
            throw new Error(`Cambridge API error status ${response.status}`);
        return await response.json();
    }
    async fetchFromFreeDictionary(lemma) {
        const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${lemma}`;
        const response = await fetch(url);
        if (!response.ok)
            throw new Error(`Free Dictionary API error status ${response.status}`);
        return await response.json();
    }
}
