import mongoose, { Schema, Document } from 'mongoose';

export interface IWordCache extends Document {
  word: string;
  source: string;
  rawPayload: any;
  createdAt: Date;
}

const WordCacheSchema: Schema = new Schema({
  word: { type: String, required: true, unique: true, index: true },
  source: { type: String, required: true },
  rawPayload: { type: Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now }
});

export const WordCache = mongoose.model<IWordCache>('WordCache', WordCacheSchema);
