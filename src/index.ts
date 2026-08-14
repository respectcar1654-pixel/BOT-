import express from 'express'
import TelegramBot from 'node-telegram-bot-api'
import dotenv from 'dotenv'
dotenv.config()

const TOKEN = process.env.TELEGRAM_BOT_TOKEN!
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID!
const PORT = process.env.PORT || 3001

const bot = new TelegramBot(TOKEN, { polling: true })
const app = express()
app.use(express.json())

// Команда /start
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, 
    '👋 Вітаємо в Respect Car\!\n\nМи допомагаємо з:\n• Продажем авто\n• Викупом авто\n• Імпортом з США\n\nЗалиште заявку на сайті або зателефонуйте: 068 896 13 16',
    { parse_mode: 'Markdown' }
  )
})

// API endpoint — приймає заявки з сайту
app.post('/api/contact', async (req, res) => {
  try {
    const { name, phone, message } = req.body

    if (!name || !phone) {
      return res.status(400).json({ error: 'Заповніть обовʼязкові поля' })
    }

    const text = [
      `🚗 *Нова заявка з сайту Respect Car*`,
      ``,
      `👤 *Імʼя:* ${name}`,
      `📞 *Телефон:* ${phone}`,
      message ? `💬 *Повідомлення:* ${message}` : null,
      ``,
      `📅 ${new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kiev' })}`,
    ].filter(Boolean).join('\n')

    await bot.sendMessage(ADMIN_CHAT_ID, text, { parse_mode: 'Markdown' })
    res.json({ success: true })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

app.get('/health', (_, res) => res.json({ status: 'ok' }))

app.listen(PORT, () => console.log(`Bot server running on port ${PORT}`))
