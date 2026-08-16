import { Bot, InlineKeyboard } from 'grammy'
import { Pool } from 'pg'
import { createClient } from 'redis'
import express from 'express'
import dotenv from 'dotenv'
dotenv.config()

const db = new Pool({ connectionString: process.env.DATABASE_URL })
const redis = createClient({ url: process.env.REDIS_URL })
redis.connect()

async function initDB() {
  await db.query(`
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

async function isAdmin(chatId: number | string): Promise<boolean> {
  const res = await db.query('SELECT id FROM admins WHERE chat_id = $1', [String(chatId)])
  return res.rows.length > 0
}

async function notifyAllAdmins(bot: Bot, text: string) {
  const res = await db.query('SELECT chat_id FROM admins')
  for (const row of res.rows) {
    try {
      await bot.api.sendMessage(row.chat_id, text, { parse_mode: 'Markdown' })
    } catch {}
  }
}

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!)

function mainMenu() {
  return new InlineKeyboard()
    .text('🚗 Продаж авто', 'prodazh').row()
    .text('💰 Викуп авто', 'vykup').row()
    .text('🇺🇸 Авто з США', 'ssha').row()
    .text('🏍 Мотоцикл', 'moto').row()
    .text('📞 Контакти', 'kontakty')
}

function adminMenu() {
  return new InlineKeyboard()
    .text('📋 Всі заявки', 'admin_list').row()
    .text('➕ Додати адміна', 'admin_add').row()
    .text('👥 Список адмінів', 'admin_admins')
}

// /start
bot.command('start', async (ctx) => {
  const name = ctx.from?.first_name || 'друже'
  const admin = await isAdmin(ctx.from!.id)

  if (admin) {
    await ctx.reply(
      `👋 Вітаємо, ${name}!\n\n⚙️ *Адмін панель Respect Car*`,
      { parse_mode: 'Markdown', reply_markup: adminMenu() }
    )
  } else {
    await ctx.reply(
      `👋 Вітаємо, ${name}!\n\nЯ бот автомайданчику *Respect Car*\nХарків, вул. Валентинівська, 12\n\nОберіть послугу:`,
      { parse_mode: 'Markdown', reply_markup: mainMenu() }
    )
  }
})

// /admin — для супер адміна
bot.command('admin', async (ctx) => {
  if (!await isAdmin(ctx.from!.id)) return
  await ctx.reply('⚙️ *Адмін панель*', { parse_mode: 'Markdown', reply_markup: adminMenu() })
})

// Список заявок
bot.callbackQuery('admin_list', async (ctx) => {
  await ctx.answerCallbackQuery()
  if (!await isAdmin(ctx.from.id)) return

  const res = await db.query(
    `SELECT id, full_name, phone, type, status, created_at FROM applications ORDER BY created_at DESC LIMIT 10`
  )

  if (res.rows.length === 0) {
    await ctx.reply('📋 Заявок ще немає')
    return
  }

  const typeLabels: Record<string, string> = {
    prodazh: '🚗 Продаж', vykup: '💰 Викуп',
    ssha: '🇺🇸 США', moto: '🏍 Мото', site_form: '🌐 Сайт',
  }
  const statusLabels: Record<string, string> = {
    new: '🆕', in_progress: '⏳', done: '✅', cancelled: '❌',
  }

  let text = '📋 *Останні 10 заявок:*\n\n'
  for (const r of res.rows) {
    text += `${statusLabels[r.status] || '🆕'} #${r.id} — ${typeLabels[r.type] || r.type}\n`
    text += `👤 ${r.full_name} | 📞 ${r.phone}\n`
    text += `📅 ${new Date(r.created_at).toLocaleString('uk-UA', { timeZone: 'Europe/Kiev' })}\n\n`
  }

  await ctx.reply(text, { parse_mode: 'Markdown' })
})

// Додати адміна
bot.callbackQuery('admin_add', async (ctx) => {
  await ctx.answerCallbackQuery()
  if (!await isAdmin(ctx.from.id)) return

  await redis.set(`admin_action:${ctx.from.id}`, 'add_admin', { EX: 300 })
  await ctx.reply('➕ Введіть Telegram ID нового адміна:\n\n_Щоб дізнатись ID — попросіть людину написати боту @userinfobot_', { parse_mode: 'Markdown' })
})

// Список адмінів
bot.callbackQuery('admin_admins', async (ctx) => {
  await ctx.answerCallbackQuery()
  if (!await isAdmin(ctx.from.id)) return

  const res = await db.query('SELECT chat_id, username, created_at FROM admins ORDER BY created_at')
  let text = '👥 *Адміни:*\n\n'
  for (const r of res.rows) {
    text += `• ${r.username || 'невідомо'} — \`${r.chat_id}\`\n`
  }

  const kb = new InlineKeyboard()
  for (const r of res.rows) {
    if (String(r.chat_id) !== process.env.TELEGRAM_ADMIN_CHAT_ID) {
      kb.text(`❌ Видалити ${r.username || r.chat_id}`, `del_admin:${r.chat_id}`).row()
    }
  }

  await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb })
})

// Видалити адміна
bot.callbackQuery(/^del_admin:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery()
  if (!await isAdmin(ctx.from.id)) return

  const chatId = ctx.match[1]
  await db.query('DELETE FROM admins WHERE chat_id = $1', [chatId])
  await ctx.reply(`✅ Адміна \`${chatId}\` видалено`, { parse_mode: 'Markdown' })
})

// Клієнтські кнопки
const serviceStarts: Record<string, string> = {
  prodazh: '🚗 *Залишити авто на продаж*\n\nЯк вас звати?',
  vykup: '💰 *Викуп авто*\n\nЯк вас звати?',
  ssha: '🇺🇸 *Авто з США під ключ*\n\nЯк вас звати?',
  moto: '🏍 *Мотоцикл під замовлення*\n\nЯк вас звати?',
}

for (const [key, msg] of Object.entries(serviceStarts)) {
  bot.callbackQuery(key, async (ctx) => {
    await ctx.answerCallbackQuery()
    if (await isAdmin(ctx.from.id)) return
    await redis.set(`session:${ctx.from.id}`, JSON.stringify({ type: key, step: 'name' }), { EX: 3600 })
    await ctx.reply(msg, { parse_mode: 'Markdown' })
  })
}

bot.callbackQuery('kontakty', async (ctx) => {
  await ctx.answerCallbackQuery()
  await ctx.reply(
    `📍 *Respect Car*\n\nХарків, вул. Валентинівська, 12\n📞 068 896 13 16\n\nInstagram:\n@respect.car\\_kh\n@respectcar\\_usa\n\n🌐 respectcar.ua`,
    { parse_mode: 'Markdown' }
  )
})

// Текстові повідомлення
bot.on('message:text', async (ctx) => {
  const userId = ctx.from.id
  const text = ctx.message.text
  if (text.startsWith('/')) return

  // Перевіряємо чи адмін додає нового адміна
  const adminAction = await redis.get(`admin_action:${userId}`)
  if (adminAction === 'add_admin' && await isAdmin(userId)) {
    const newId = text.trim()
    if (!/^\d+$/.test(newId)) {
      await ctx.reply('❌ Невірний формат. Введіть числовий Telegram ID')
      return
    }
    await db.query(
      `INSERT INTO admins (chat_id, username, added_by) VALUES ($1, $2, $3) ON CONFLICT (chat_id) DO NOTHING`,
      [newId, '', userId]
    )
    await redis.del(`admin_action:${userId}`)
    await ctx.reply(`✅ Адміна \`${newId}\` додано!`, { parse_mode: 'Markdown', reply_markup: adminMenu() })

    try {
      await bot.api.sendMessage(Number(newId),
        `✅ Вас додано як адміна бота *Respect Car*\n\nНатисніть /admin для входу в панель`,
        { parse_mode: 'Markdown' }
      )
    } catch {}
    return
  }

  // Клієнтська сесія
  const sessionRaw = await redis.get(`session:${userId}`)
  if (!sessionRaw) {
    await ctx.reply('Оберіть послугу:', { reply_markup: mainMenu() })
    return
  }

  const session = JSON.parse(sessionRaw)

  if (session.step === 'name') {
    session.name = text
    session.step = 'phone'
    await redis.set(`session:${userId}`, JSON.stringify(session), { EX: 3600 })
    await ctx.reply(`Дякую, ${text}! Вкажіть ваш номер телефону:`)
    return
  }

  if (session.step === 'phone') {
    session.phone = text
    session.step = 'details'
    await redis.set(`session:${userId}`, JSON.stringify(session), { EX: 3600 })
    const q: Record<string, string> = {
      prodazh: 'Марка, модель, рік та ціна вашого авто?',
      vykup: 'Марка, модель, рік та стан авто?',
      ssha: 'Яку марку, модель, рік та бюджет розглядаєте?',
      moto: 'Яку марку мотоцикла та бюджет розглядаєте?',
    }
    await ctx.reply(q[session.type] || 'Опишіть детально:')
    return
  }

  if (session.step === 'details') {
    session.details = text
    const result = await db.query(
      `INSERT INTO applications (user_id, username, full_name, phone, type, data)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [userId, ctx.from.username || '', session.name, session.phone, session.type, JSON.stringify({ details: text })]
    )
    const appId = result.rows[0].id
    const typeLabels: Record<string, string> = {
      prodazh: '🚗 Продаж авто', vykup: '💰 Викуп авто', ssha: '🇺🇸 Авто з США', moto: '🏍 Мотоцикл',
    }
    await notifyAllAdmins(bot,
      `📩 *Нова заявка #${appId} — ${typeLabels[session.type]}*\n\n` +
      `👤 *Ім'я:* ${session.name}\n📞 *Телефон:* ${session.phone}\n💬 *Деталі:* ${text}\n` +
      `🔗 ${ctx.from.username ? '@' + ctx.from.username : 'немає username'}\n` +
      `📅 ${new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kiev' })}`
    )
    await redis.del(`session:${userId}`)
    await ctx.reply(
      `✅ *Заявку #${appId} прийнято!*\n\nМи зв'яжемося з вами найближчим часом.\n📞 068 896 13 16`,
      { parse_mode: 'Markdown', reply_markup: mainMenu() }
    )
  }
})

// Express
const app = express()
app.use(express.json())
app.get('/health', (_, res) => res.json({ status: 'ok' }))
app.post('/api/contact', async (req, res) => {
  try {
    const { name, phone, message } = req.body
    if (!name || !phone) return res.status(400).json({ error: 'Missing fields' })
    const result = await db.query(
      `INSERT INTO applications (user_id, full_name, phone, type, data) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [0, name, phone, 'site_form', JSON.stringify({ message })]
    )
    const appId = result.rows[0].id
    await notifyAllAdmins(bot,
      `🌐 *Заявка #${appId} з сайту*\n\n👤 *Ім'я:* ${name}\n📞 *Телефон:* ${phone}${message ? `\n💬 *Повідомлення:* ${message}` : ''}\n📅 ${new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kiev' })}`
    )
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, async () => {
  await initDB()
  console.log(`Server on port ${PORT}`)
  bot.start()
  console.log('Bot started')
})
