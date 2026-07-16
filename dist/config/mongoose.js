import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/langcurve';
export async function connectMongoDB() {
    await mongoose.connect(mongoUri);
    console.log('MongoDB (Mongoose) connected successfully.');
}
export default mongoose;
