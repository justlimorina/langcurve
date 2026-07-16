import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// Connects to PostgreSQL database automatically
export async function connectPostgres() {
  await prisma.$connect();
  console.log('PostgreSQL (Prisma) connected successfully.');
}
