import { db } from '../services/db'
import { Bot } from 'grammy'

export async function isAdmin(chatId: number | string): Promise<boolean> {
  const res = await db.query('SELECT id FROM admins WHERE chat_id = $1', [String(chatId)])
  return res.rows.length > 0
}

export async function notifyAllAdmins(bot: Bot, text: string) {
  const res = await db.query('SELECT chat_id FROM admins')
  for (const row of res.rows) {
    try {
      await bot.api.sendMessage(row.chat_id, text, { parse_mode: 'Markdown' })
    } catch {}
  }
}
