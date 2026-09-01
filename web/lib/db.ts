import { PrismaClient } from "@prisma/client";

// A single client across hot reloads in development, otherwise every edit
// leaks another connection pool.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
