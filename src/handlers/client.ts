import { Bot } from 'grammy'
import { redis } from '../services/redis'
import { db } from '../services/db'
import { isAdmin, notifyAllAdmins } from '../middleware/auth'
import { mainMenu, adminMenu } from './menus'

export function registerClientHandlers(bot: Bot) {
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

  bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id
    const text = ctx.message.text
    if (text.startsWith('/')) return
    if (await isAdmin(userId)) return

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
}
