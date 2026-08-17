import { Pool } from 'pg'

export const db = new Pool({ connectionString: process.env.DATABASE_URL })

export async function initDB() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS cars (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      price TEXT NOT NULL,
      year TEXT,
      mileage TEXT,
      engine TEXT,
      description TEXT,
      photos TEXT[] DEFAULT '{}',
      category TEXT DEFAULT 'sedan',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS applications (
      id SERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL DEFAULT 0,
      username TEXT DEFAULT '',
      full_name TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      type TEXT NOT NULL,
      data JSONB DEFAULT '{}',
      status TEXT DEFAULT 'new',
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT UNIQUE NOT NULL,
      username TEXT DEFAULT '',
      added_by BIGINT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `)

  const superAdmin = process.env.TELEGRAM_ADMIN_CHAT_ID!
  await db.query(
    `INSERT INTO admins (chat_id, username, added_by) VALUES ($1, 'superadmin', $1)
     ON CONFLICT (chat_id) DO NOTHING`,
    [superAdmin]
  )
  console.log('DB ready')
}
