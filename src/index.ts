import { Bot } from 'grammy'
import express from 'express'
import dotenv from 'dotenv'
import { v2 as cloudinary } from 'cloudinary'
import rateLimit from 'express-rate-limit'
import { initDB } from './services/db'
import { isAdmin } from './middleware/auth'
import { mainMenu, adminMenu, ADMIN_HELP_TEXT } from './handlers/menus'
import { registerClientHandlers } from './handlers/client'
import { registerAdminHandlers } from './handlers/admin'

dotenv.config()

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
})

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!)

// /start — клієнтське меню для всіх
bot.command('start', async (ctx) => {
  const name = ctx.from?.first_name || 'друже'
  await ctx.reply(
    `👋 Вітаємо, ${name}!\n\nЯ бот автомайданчику *Respect Car*\nХарків, вул. Валентинівська, 12\n\nОберіть послугу:`,
    { parse_mode: 'Markdown', reply_markup: mainMenu() }
  )
})

// /admin — тільки для адмінів
bot.command('admin', async (ctx) => {
  if (!await isAdmin(ctx.from!.id)) {
    await ctx.reply('⛔️ Доступ заборонено')
    return
  }
  const name = ctx.from?.first_name || 'адміне'
  await ctx.reply(
    `⚙️ *Адмін панель Respect Car*\n\nВітаємо, ${name}!`,
    { parse_mode: 'Markdown', reply_markup: adminMenu() }
  )
})

// Кнопка "Меню клієнта" в адмін панелі
bot.callbackQuery('admin_client_menu', async (ctx) => {
  await ctx.answerCallbackQuery()
  if (!await isAdmin(ctx.from.id)) return
  await ctx.reply(
    '👤 *Меню клієнта*\n\nОберіть послугу:',
    { parse_mode: 'Markdown', reply_markup: mainMenu() }
  )
})

// Кнопка "Інструкція"
bot.callbackQuery('admin_help', async (ctx) => {
  await ctx.answerCallbackQuery()
  if (!await isAdmin(ctx.from.id)) return
  await ctx.reply(ADMIN_HELP_TEXT, {
    parse_mode: 'Markdown',
    reply_markup: adminMenu(),
  })
})

registerAdminHandlers(bot)
registerClientHandlers(bot)

// Express
const app = express()
app.use(express.json())

const contactLimiter = rateLimit({ windowMs: 60_000, max: 5, message: { error: 'Забагато запитів. Спробуйте через хвилину.' } })
const webhookLimiter = rateLimit({ windowMs: 1_000, max: 30 })

app.get('/health', (_, res) => res.json({ status: 'ok' }))

app.post('/api/contact', contactLimiter, async (req, res) => {
  try {
    const { name, phone, message } = req.body
    if (!name || !phone) return res.status(400).json({ error: 'Missing fields' })
    const { db } = await import('./services/db')
    const { notifyAllAdmins } = await import('./middleware/auth')
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

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || ''
const WEBHOOK_URL = process.env.WEBHOOK_URL || ''
const PORT = process.env.PORT || 3000

app.post('/webhook', webhookLimiter, (req, res) => {
  if (WEBHOOK_SECRET) {
    const token = req.headers['x-telegram-bot-api-secret-token']
    if (token !== WEBHOOK_SECRET) { res.sendStatus(403); return }
  }
  bot.handleUpdate(req.body)
  res.sendStatus(200)
})

app.listen(PORT, async () => {
  await initDB()
  console.log(`Server on port ${PORT}`)

  if (WEBHOOK_URL) {
    await bot.init()
    await bot.api.setWebhook(`${WEBHOOK_URL}/webhook`, { secret_token: WEBHOOK_SECRET || undefined })

    // Команди для звичайних юзерів (глобальні)
    await bot.api.setMyCommands([
      { command: 'start', description: '🏠 Головне меню' },
    ])

    // Команди для адмінів (через BotFather scope)
    await bot.api.setMyCommands([
      { command: 'start', description: '🏠 Головне меню клієнта' },
      { command: 'admin', description: '⚙️ Адмін панель' },
      { command: 'addcar', description: '🚗 Додати авто в каталог' },
      { command: 'deletecars', description: '🗑 Видалити авто зі списку' },
      { command: 'done', description: '✅ Завершити додавання авто' },
    ], { scope: { type: 'all_private_chats' } })

    console.log(`Webhook set: ${WEBHOOK_URL}/webhook`)
  } else {
    bot.start()
    console.log('Bot started (polling)')
  }
})
