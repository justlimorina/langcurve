import mongoose, { Schema } from 'mongoose';
const WordCacheSchema = new Schema({
    word: { type: String, required: true, unique: true, index: true },
    source: { type: String, required: true },
    rawPayload: { type: Schema.Types.Mixed, required: true },
    createdAt: { type: Date, default: Date.now }
});
export const WordCache = mongoose.model('WordCache', WordCacheSchema);
