import postgres from "postgres";

const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

// Single shared connection pool to Tiger; reused across hot reloads in dev.
export const sql =
  globalForDb.sql ??
  postgres(process.env.DATABASE_URL!, {
    ssl: "require",
    max: 5,
    connect_timeout: 5,
    idle_timeout: 20,
  });

if (process.env.NODE_ENV !== "production") globalForDb.sql = sql;