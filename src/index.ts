import { Bot, InlineKeyboard, Context } from 'grammy'
import { Pool } from 'pg'
import { createClient } from 'redis'
import express from 'express'
import dotenv from 'dotenv'
dotenv.config()

// ── DB ──
const db = new Pool({ connectionString: process.env.DATABASE_URL })
const redis = createClient({ url: process.env.REDIS_URL })
redis.connect()

// ── Init tables ──
async function initDB() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS applications (
      id SERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      username TEXT,
      full_name TEXT,
      phone TEXT,
      type TEXT NOT NULL,
      data JSONB DEFAULT '{}',
      status TEXT DEFAULT 'new',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `)
  console.log('DB ready')
}

// ── Bot ──
const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!)
const ADMIN_ID = process.env.TELEGRAM_ADMIN_CHAT_ID!

// Головне меню
function mainMenu() {
  return new InlineKeyboard()
    .text('🚗 Продаж авто', 'prodazh').row()
    .text('💰 Викуп авто', 'vykup').row()
    .text('🇺🇸 Авто з США', 'ssha').row()
    .text('🏍 Мотоцикл', 'moto').row()
    .text('📞 Контакти', 'kontakty')
}

// /start
bot.command('start', async (ctx) => {
  const name = ctx.from?.first_name || 'друже'
  await ctx.reply(
    `👋 Вітаємо, ${name}!\n\nЯ бот автомайданчику *Respect Car* — Харків, вул. Валентинівська, 12.\n\nОберіть послугу:`,
    { parse_mode: 'Markdown', reply_markup: mainMenu() }
  )
})

// Продаж
bot.callbackQuery('prodazh', async (ctx) => {
  await ctx.answerCallbackQuery()
  await redis.set(`session:${ctx.from.id}`, JSON.stringify({ type: 'prodazh', step: 'name' }), { EX: 3600 })
  await ctx.reply('🚗 *Залишити авто на продаж*\n\nЯк вас звати?', { parse_mode: 'Markdown' })
})

// Викуп
bot.callbackQuery('vykup', async (ctx) => {
  await ctx.answerCallbackQuery()
  await redis.set(`session:${ctx.from.id}`, JSON.stringify({ type: 'vykup', step: 'name' }), { EX: 3600 })
  await ctx.reply('💰 *Викуп авто*\n\nЯк вас звати?', { parse_mode: 'Markdown' })
})

// США
bot.callbackQuery('ssha', async (ctx) => {
  await ctx.answerCallbackQuery()
  await redis.set(`session:${ctx.from.id}`, JSON.stringify({ type: 'ssha', step: 'name' }), { EX: 3600 })
  await ctx.reply('🇺🇸 *Авто з США під ключ*\n\nЯк вас звати?', { parse_mode: 'Markdown' })
})

// Мото
bot.callbackQuery('moto', async (ctx) => {
  await ctx.answerCallbackQuery()
  await redis.set(`session:${ctx.from.id}`, JSON.stringify({ type: 'moto', step: 'name' }), { EX: 3600 })
  await ctx.reply('🏍 *Мотоцикл під замовлення*\n\nЯк вас звати?', { parse_mode: 'Markdown' })
})

// Контакти
bot.callbackQuery('kontakty', async (ctx) => {
  await ctx.answerCallbackQuery()
  await ctx.reply(
    `📍 *Respect Car*\n\nХарків, вул. Валентинівська, 12\n📞 068 896 13 16\n\nInstagram:\n@respect.car\\_kh\n@respectcar\\_usa\n\n🌐 respectcar.ua`,
    { parse_mode: 'Markdown' }
  )
})

// Обробка текстових повідомлень — кроки анкети
bot.on('message:text', async (ctx) => {
  const userId = ctx.from.id
  const text = ctx.message.text

  if (text.startsWith('/')) return

  const sessionRaw = await redis.get(`session:${userId}`)
  if (!sessionRaw) {
    await ctx.reply('Оберіть послугу:', { reply_markup: mainMenu() })
    return
  }

  const session = JSON.parse(sessionRaw)

  // Крок 1 — ім'я
  if (session.step === 'name') {
    session.name = text
    session.step = 'phone'
    await redis.set(`session:${userId}`, JSON.stringify(session), { EX: 3600 })
    await ctx.reply(`✅ Дякую, ${text}!\n\nВкажіть ваш номер телефону:`)
    return
  }

  // Крок 2 — телефон
  if (session.step === 'phone') {
    session.phone = text
    session.step = 'details'
    await redis.set(`session:${userId}`, JSON.stringify(session), { EX: 3600 })

    const questions: Record<string, string> = {
      prodazh: 'Марка, модель, рік та ціна вашого авто?',
      vykup: 'Марка, модель, рік та стан вашого авто?',
      ssha: 'Яку марку, модель, рік та бюджет розглядаєте?',
      moto: 'Яку марку, модель мотоцикла розглядаєте та бюджет?',
    }
    await ctx.reply(questions[session.type] || 'Опишіть детально:')
    return
  }

  // Крок 3 — деталі → зберігаємо заявку
  if (session.step === 'details') {
    session.details = text

    // Зберігаємо в PostgreSQL
    await db.query(
      `INSERT INTO applications (user_id, username, full_name, phone, type, data)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        ctx.from.username || '',
        session.name,
        session.phone,
        session.type,
        JSON.stringify({ details: text }),
      ]
    )

    // Відправляємо адміну
    const typeLabels: Record<string, string> = {
      prodazh: '🚗 Продаж авто',
      vykup: '💰 Викуп авто',
      ssha: '🇺🇸 Авто з США',
      moto: '🏍 Мотоцикл',
    }

    await bot.api.sendMessage(
      ADMIN_ID,
      `📩 *Нова заявка — ${typeLabels[session.type]}*\n\n` +
      `👤 *Ім'я:* ${session.name}\n` +
      `📞 *Телефон:* ${session.phone}\n` +
      `💬 *Деталі:* ${text}\n\n` +
      `🔗 Telegram: ${ctx.from.username ? '@' + ctx.from.username : 'немає'}\n` +
      `📅 ${new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kiev' })}`,
      { parse_mode: 'Markdown' }
    )

    // Очищаємо сесію
    await redis.del(`session:${userId}`)

    await ctx.reply(
      `✅ *Заявку прийнято!*\n\nМи зв'яжемося з вами найближчим часом.\n\n📞 Або телефонуйте: 068 896 13 16`,
      { parse_mode: 'Markdown', reply_markup: mainMenu() }
    )
  }
})

// Express для health check та webhook від сайту
const app = express()
app.use(express.json())

app.get('/health', (_, res) => res.json({ status: 'ok' }))

app.post('/api/contact', async (req, res) => {
  try {
    const { name, phone, message } = req.body
    if (!name || !phone) return res.status(400).json({ error: 'Missing fields' })

    await db.query(
      `INSERT INTO applications (user_id, full_name, phone, type, data)
       VALUES ($1, $2, $3, $4, $5)`,
      [0, name, phone, 'site_form', JSON.stringify({ message })]
    )

    const text = [
      `🌐 *Заявка з сайту Respect Car*`,
      ``,
      `👤 *Ім'я:* ${name}`,
      `📞 *Телефон:* ${phone}`,
      message ? `💬 *Повідомлення:* ${message}` : null,
      ``,
      `📅 ${new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kiev' })}`,
    ].filter(Boolean).join('\n')

    await bot.api.sendMessage(ADMIN_ID, text, { parse_mode: 'Markdown' })
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, async () => {
  await initDB()
  console.log(`Bot server running on port ${PORT}`)
  bot.start()
  console.log('Bot started')
})
