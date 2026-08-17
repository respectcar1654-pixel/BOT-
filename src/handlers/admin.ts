import { Bot, InlineKeyboard } from 'grammy'
import { randomUUID } from 'crypto'
import { v2 as cloudinary } from 'cloudinary'
import { redis } from '../services/redis'
import { db } from '../services/db'
import { isAdmin, notifyAllAdmins } from '../middleware/auth'
import { adminMenu, categoryKeyboard } from './menus'

export interface AddCarSession {
  step: 'title'|'price'|'year'|'mileage'|'engine'|'description'|'category'|'photos'
  sessionKey: string
  title?: string
  price?: string
  year?: string
  mileage?: string
  engine?: string
  description?: string
  category?: string
  photos: string[]
  editCarId?: string
  keepPhotos?: boolean
}

const ADDCAR_STEPS: Record<string, { next: AddCarSession['step'] | null; prompt: string }> = {
  title:       { next: 'price',       prompt: '✍️ *Крок 2/7* — Введіть ціну авто:\n_Наприклад: $25,000_' },
  price:       { next: 'year',        prompt: '📅 *Крок 3/7* — Введіть рік випуску:' },
  year:        { next: 'mileage',     prompt: '🔢 *Крок 4/7* — Введіть пробіг:\n_Наприклад: 85,000 км_' },
  mileage:     { next: 'engine',      prompt: '⚙️ *Крок 5/7* — Введіть двигун:\n_Наприклад: 3.0L V6 Diesel_' },
  engine:      { next: 'description', prompt: '📝 *Крок 6/7* — Введіть опис авто:' },
  description: { next: 'category',    prompt: '🏷 *Крок 7/7* — Оберіть категорію:' },
  category:    { next: 'photos',      prompt: '📸 *Крок 8* — Надсилайте фото (до 10 штук).\nКоли закінчите — надішліть /done' },
  photos:      { next: null,          prompt: '' },
}

export function registerAdminHandlers(bot: Bot) {
  // /admin
  bot.command('admin', async (ctx) => {
    if (!await isAdmin(ctx.from!.id)) return
    await ctx.reply('⚙️ *Адмін панель*', { parse_mode: 'Markdown', reply_markup: adminMenu() })
  })

  // /addcar
  bot.command('addcar', async (ctx) => {
    if (!await isAdmin(ctx.from!.id)) return
    const sessionKey = randomUUID().replace(/-/g, '')
    const session: AddCarSession = { step: 'title', sessionKey, photos: [] }
    await redis.del(`photos_list:${ctx.from!.id}`)
    await redis.set(`addcar:${ctx.from!.id}`, JSON.stringify(session), { EX: 7200 })
    await ctx.reply('🚗 *Додати авто у каталог*\n\n*Крок 1/7* — Введіть назву авто:\n_Наприклад: BMW X5 2022_', { parse_mode: 'Markdown' })
  })

  // /done
  bot.command('done', async (ctx) => {
    const userId = ctx.from!.id
    if (!await isAdmin(userId)) return
    const raw = await redis.get(`addcar:${userId}`)
    if (!raw) { await ctx.reply('❌ Немає активного діалогу. Почніть з /addcar'); return }
    const session: AddCarSession = JSON.parse(raw)
    if (session.step !== 'photos') { await ctx.reply('❌ Спочатку завершіть всі кроки'); return }
    if (!session.title || !session.price) { await ctx.reply('❌ Не вистачає даних (назва або ціна)'); return }

    if (session.editCarId) {
      await db.query(
        `UPDATE cars SET title=$1, price=$2, year=$3, mileage=$4, engine=$5, description=$6, category=$7
         ${!session.keepPhotos ? ', photos=$8' : ''} WHERE id=${session.keepPhotos ? '$8' : '$9'}`,
        session.keepPhotos
          ? [session.title, session.price, session.year||'', session.mileage||'', session.engine||'', session.description||'', session.category||'sedan', session.editCarId]
          : [session.title, session.price, session.year||'', session.mileage||'', session.engine||'', session.description||'', session.category||'sedan', session.photos, session.editCarId]
      )
      await redis.del(`addcar:${userId}`)
      await redis.del(`photos_list:${userId}`)
      await ctx.reply(`✅ *Авто оновлено!*\n\n🚗 ${session.title}`, { parse_mode: 'Markdown', reply_markup: adminMenu() })
      return
    }

    const result = await db.query(
      `INSERT INTO cars (title, price, year, mileage, engine, description, photos, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [session.title, session.price, session.year||'', session.mileage||'', session.engine||'', session.description||'', session.photos, session.category||'sedan']
    )
    await redis.del(`addcar:${userId}`)
      await redis.del(`photos_list:${userId}`)
    await ctx.reply(
      `✅ *Авто додано!*\n\n🚗 ${session.title}\n💰 ${session.price}\n📸 ${session.photos.length} фото\n🆔 ID: ${result.rows[0].id}`,
      { parse_mode: 'Markdown' }
    )
  })

  // /deletecars
  bot.command('deletecars', async (ctx) => {
    if (!await isAdmin(ctx.from!.id)) return
    const res = await db.query(`SELECT id, title, price FROM cars WHERE is_active=true ORDER BY created_at DESC LIMIT 20`)
    if (res.rows.length === 0) { await ctx.reply('🗃 Каталог порожній'); return }
    const kb = new InlineKeyboard()
    for (const row of res.rows) kb.text(`❌ ${row.title} — ${row.price}`, `del_car:${row.id}`).row()
    await ctx.reply(`🗑 *Оберіть авто для видалення:*`, { parse_mode: 'Markdown', reply_markup: kb })
  })

  // Категорія
  bot.callbackQuery(/^cat:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    const userId = ctx.from.id
    if (!await isAdmin(userId)) return
    const raw = await redis.get(`addcar:${userId}`)
    if (!raw) return
    const session: AddCarSession = JSON.parse(raw)
    if (session.step !== 'category') return
    session.category = ctx.match[1]
    session.step = 'photos'
    await redis.set(`addcar:${userId}`, JSON.stringify(session), { EX: 7200 })
    await ctx.editMessageText(
      `✅ Категорія: *${ctx.match[1]}*\n\n📸 *Крок 8* — Надсилайте фото (до 10 штук).\nКоли закінчите — надішліть /done`,
      { parse_mode: 'Markdown' }
    )
  })

  // Адмін кнопки
  bot.callbackQuery('admin_addcar', async (ctx) => {
    await ctx.answerCallbackQuery()
    if (!await isAdmin(ctx.from.id)) return
    await ctx.api.sendMessage(ctx.from.id, '/addcar')
    ctx.reply('Використайте команду /addcar')
  })

  bot.callbackQuery('admin_cars', async (ctx) => {
    await ctx.answerCallbackQuery()
    if (!await isAdmin(ctx.from.id)) return
    const res = await db.query('SELECT id, title, price, is_active FROM cars ORDER BY created_at DESC LIMIT 10')
    if (res.rows.length === 0) { await ctx.reply('🚗 Авто ще немає. Додайте через /addcar'); return }
    const kb = new InlineKeyboard()
    for (const car of res.rows) {
      kb.text(`${car.is_active ? '✅' : '❌'} ${car.title} — ${car.price}`, `car_toggle:${car.id}`).row()
      kb.text(`🗑 Видалити`, `car_delete:${car.id}`).row()
    }
    await ctx.reply('🚗 *Список авто:*', { parse_mode: 'Markdown', reply_markup: kb })
  })

  bot.callbackQuery(/^car_toggle:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    if (!await isAdmin(ctx.from.id)) return
    await db.query('UPDATE cars SET is_active = NOT is_active WHERE id = $1', [ctx.match[1]])
    await ctx.reply('✅ Статус авто оновлено', { reply_markup: adminMenu() })
  })

  bot.callbackQuery(/^car_delete:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    if (!await isAdmin(ctx.from.id)) return
    try {
      await fetch(`${process.env.SITE_URL}/api/cars/${ctx.match[1]}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${process.env.UPLOAD_SECRET}` },
      })
    } catch {}
    await db.query('DELETE FROM cars WHERE id = $1', [ctx.match[1]])
    await ctx.reply('🗑 Авто видалено', { reply_markup: adminMenu() })
  })

  bot.callbackQuery(/^del_car:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    if (!await isAdmin(ctx.from.id)) return
    const res = await db.query(`UPDATE cars SET is_active=false WHERE id=$1 RETURNING title`, [ctx.match[1]])
    if (res.rows.length === 0) { await ctx.reply('❌ Авто не знайдено'); return }
    await ctx.reply(`✅ Авто *${res.rows[0].title}* прибрано з каталогу`, { parse_mode: 'Markdown' })
  })

  bot.callbackQuery('admin_list', async (ctx) => {
    await ctx.answerCallbackQuery()
    if (!await isAdmin(ctx.from.id)) return
    const res = await db.query(`SELECT id, full_name, phone, type, status, created_at FROM applications ORDER BY created_at DESC LIMIT 10`)
    if (res.rows.length === 0) { await ctx.reply('📋 Заявок ще немає'); return }
    const typeLabels: Record<string, string> = { prodazh: '🚗 Продаж', vykup: '💰 Викуп', ssha: '🇺🇸 США', moto: '🏍 Мото', site_form: '🌐 Сайт' }
    const statusLabels: Record<string, string> = { new: '🆕', in_progress: '⏳', done: '✅', cancelled: '❌' }
    let text = '📋 *Останні 10 заявок:*\n\n'
    for (const r of res.rows) {
      text += `${statusLabels[r.status] || '🆕'} #${r.id} — ${typeLabels[r.type] || r.type}\n`
      text += `👤 ${r.full_name} | 📞 ${r.phone}\n`
      text += `📅 ${new Date(r.created_at).toLocaleString('uk-UA', { timeZone: 'Europe/Kiev' })}\n\n`
    }
    await ctx.reply(text, { parse_mode: 'Markdown' })
  })

  bot.callbackQuery('admin_add', async (ctx) => {
    await ctx.answerCallbackQuery()
    if (!await isAdmin(ctx.from.id)) return
    await redis.set(`admin_action:${ctx.from.id}`, 'add_admin', { EX: 300 })
    await ctx.reply('➕ Введіть Telegram ID нового адміна:', { parse_mode: 'Markdown' })
  })

  bot.callbackQuery('admin_admins', async (ctx) => {
    await ctx.answerCallbackQuery()
    if (!await isAdmin(ctx.from.id)) return
    const res = await db.query('SELECT chat_id, username, created_at FROM admins ORDER BY created_at')
    let text = '👥 *Адміни:*\n\n'
    for (const r of res.rows) text += `• ${r.username || 'невідомо'} — \`${r.chat_id}\`\n`
    const kb = new InlineKeyboard()
    for (const r of res.rows) {
      if (String(r.chat_id) !== process.env.TELEGRAM_ADMIN_CHAT_ID)
        kb.text(`❌ Видалити ${r.username || r.chat_id}`, `del_admin:${r.chat_id}`).row()
    }
    await ctx.reply(text, { parse_mode: 'Markdown', reply_markup: kb })
  })

  bot.callbackQuery(/^del_admin:(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    if (!await isAdmin(ctx.from.id)) return
    await db.query('DELETE FROM admins WHERE chat_id = $1', [ctx.match[1]])
    await ctx.reply(`✅ Адміна \`${ctx.match[1]}\` видалено`, { parse_mode: 'Markdown' })
  })

  // Редагування авто
  bot.callbackQuery('admin_editcar', async (ctx) => {
    await ctx.answerCallbackQuery()
    if (!await isAdmin(ctx.from.id)) return
    const res = await db.query('SELECT id, title, price FROM cars WHERE is_active = true ORDER BY id DESC LIMIT 20')
    if (res.rows.length === 0) { await ctx.reply('🚗 Авто ще немає.', { reply_markup: adminMenu() }); return }
    const kb = new InlineKeyboard()
    for (const car of res.rows) kb.text(`${car.title} — ${car.price}`, `edit_car:${car.id}`).row()
    await ctx.reply('✏️ *Оберіть авто для редагування:*', { parse_mode: 'Markdown', reply_markup: kb })
  })

  bot.callbackQuery(/^edit_car:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    if (!await isAdmin(ctx.from.id)) return
    const res = await db.query('SELECT * FROM cars WHERE id = $1', [ctx.match[1]])
    if (res.rows.length === 0) { await ctx.reply('❌ Авто не знайдено'); return }
    const car = res.rows[0]
    const kb = new InlineKeyboard()
      .text('📝 Назва', `edit_field:${car.id}:title`).text('💰 Ціна', `edit_field:${car.id}:price`).row()
      .text('📅 Рік', `edit_field:${car.id}:year`).text('🔢 Пробіг', `edit_field:${car.id}:mileage`).row()
      .text('⚙️ Двигун', `edit_field:${car.id}:engine`).text('🏷 Категорія', `edit_field:${car.id}:category`).row()
      .text('📄 Опис', `edit_field:${car.id}:description`).row()
      .text('🔄 Змінити все + фото', `edit_full:${car.id}`).row()
      .text('🔄 Змінити все (фото зберегти)', `edit_nophoto:${car.id}`).row()
      .text('◀️ Назад', 'admin_editcar')
    await ctx.reply(
      `✏️ *${car.title}*\n💰 ${car.price} | 📅 ${car.year} | 🔢 ${car.mileage}\n⚙️ ${car.engine}\n🏷 ${car.category}`,
      { parse_mode: 'Markdown', reply_markup: kb }
    )
  })

  bot.callbackQuery(/^edit_field:(\d+):(\w+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    if (!await isAdmin(ctx.from.id)) return
    const [carId, field] = [ctx.match[1], ctx.match[2]]
    const fieldNames: Record<string, string> = { title: 'назву', price: 'ціну', year: 'рік', mileage: 'пробіг', engine: 'двигун', category: 'категорію', description: 'опис' }
    await redis.set(`edit_field:${ctx.from.id}`, JSON.stringify({ carId, field }), { EX: 300 })
    await ctx.reply(`✏️ Введіть нову ${fieldNames[field] || field}:`)
  })

  bot.callbackQuery(/^edit_full:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    if (!await isAdmin(ctx.from.id)) return
    const sessionKey = randomUUID().replace(/-/g, '')
    const session: AddCarSession = { step: 'title', sessionKey, photos: [], editCarId: ctx.match[1], keepPhotos: false }
    await redis.set(`addcar:${ctx.from.id}`, JSON.stringify(session), { EX: 7200 })
    await ctx.reply('📝 *Крок 1/7* — Введіть нову назву авто:', { parse_mode: 'Markdown' })
  })

  bot.callbackQuery(/^edit_nophoto:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery()
    if (!await isAdmin(ctx.from.id)) return
    const sessionKey = randomUUID().replace(/-/g, '')
    const session: AddCarSession = { step: 'title', sessionKey, photos: [], editCarId: ctx.match[1], keepPhotos: true }
    await redis.set(`addcar:${ctx.from.id}`, JSON.stringify(session), { EX: 7200 })
    await ctx.reply('📝 *Крок 1/7* — Введіть нову назву авто:', { parse_mode: 'Markdown' })
  })

  // Фото
  bot.on('message:photo', async (ctx) => {
    const userId = ctx.from.id
    if (!await isAdmin(userId)) return
    const raw = await redis.get(`addcar:${userId}`)
    if (!raw) return
    const session: AddCarSession = JSON.parse(raw)
    if (session.step !== 'photos') return
    const currentCount = await redis.lLen(`photos_list:${userId}`)
    if (currentCount >= 10) { await ctx.reply('⚠️ Максимум 10 фото. Надішліть /done щоб зберегти.'); return }

    const photo = ctx.message.photo.at(-1)!

    // Дедуплікація — ігноруємо повторні події для того ж фото
    const dedupKey = `photo_dedup:${userId}:${photo.file_unique_id}`
    if (await redis.get(dedupKey)) return
    await redis.set(dedupKey, '1', { EX: 60 })

    try {
      const file = await ctx.api.getFile(photo.file_id)
      const tgUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`
      const photoRes = await fetch(tgUrl)
      const photoBuffer = Buffer.from(await photoRes.arrayBuffer())

      const uploadResult = await new Promise<{secure_url: string}>((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: `respect-car/${session.sessionKey}`, resource_type: 'image' },
          (err: Error | undefined, result: {secure_url: string} | undefined) => {
            if (err) reject(err); else resolve(result!)
          }
        ).end(photoBuffer)
      })

      // Атомарно додаємо URL в Redis LIST — rPush повертає новий розмір (без race condition)
      const listKey = `photos_list:${userId}`
      const count = await redis.rPush(listKey, uploadResult.secure_url)
      await redis.expire(listKey, 7200)

      // Синхронізуємо сесію з поточним списком фото
      const freshRaw = await redis.get(`addcar:${userId}`)
      if (freshRaw) {
        const freshSession: AddCarSession = JSON.parse(freshRaw)
        const allPhotos = await redis.lRange(listKey, 0, -1)
        freshSession.photos = allPhotos
        await redis.set(`addcar:${userId}`, JSON.stringify(freshSession), { EX: 7200 })
      }

      await ctx.reply(`✅ Фото ${count}/10 збережено. Надішліть ще або /done`)
    } catch (err) {
      console.error('Photo upload error:', err)
      await ctx.reply('❌ Помилка завантаження фото. Спробуйте ще раз.')
    }
  })

  // Текстові повідомлення адміна
  bot.on('message:text', async (ctx) => {
    const userId = ctx.from.id
    const text = ctx.message.text
    if (text.startsWith('/')) return
    if (!await isAdmin(userId)) return

    const addcarRaw = await redis.get(`addcar:${userId}`)
    if (addcarRaw) {
      const session: AddCarSession = JSON.parse(addcarRaw)
      const stepKey = session.step as keyof typeof ADDCAR_STEPS
      if (stepKey === 'photos') { await ctx.reply('📸 Надсилайте фото або /done'); return }
      if (stepKey === 'category') { await ctx.reply('Оберіть категорію кнопкою:', { reply_markup: categoryKeyboard() }); return }
      const mutable = session as unknown as Record<string, unknown>
      mutable[stepKey] = text
      session.step = ADDCAR_STEPS[stepKey].next as AddCarSession['step']
      await redis.set(`addcar:${userId}`, JSON.stringify(session), { EX: 7200 })
      if (session.step === 'category') {
        await ctx.reply(ADDCAR_STEPS[stepKey].prompt, { parse_mode: 'Markdown', reply_markup: categoryKeyboard() })
      } else {
        await ctx.reply(ADDCAR_STEPS[stepKey].prompt, { parse_mode: 'Markdown' })
      }
      return
    }

    const editFieldRaw = await redis.get(`edit_field:${userId}`)
    if (editFieldRaw) {
      const { carId, field } = JSON.parse(editFieldRaw)
      const ALLOWED_FIELDS = ['title', 'price', 'year', 'mileage', 'engine', 'category', 'description']
      if (!ALLOWED_FIELDS.includes(field)) { await redis.del(`edit_field:${userId}`); await ctx.reply('❌ Недозволене поле'); return }
      await db.query(`UPDATE cars SET ${field} = $1 WHERE id = $2`, [text, carId])
      await redis.del(`edit_field:${userId}`)
      await ctx.reply(`✅ *${field}* оновлено!`, { parse_mode: 'Markdown', reply_markup: adminMenu() })
      return
    }

    const adminAction = await redis.get(`admin_action:${userId}`)
    if (adminAction === 'add_admin') {
      const newId = text.trim()
      if (!/^\d+$/.test(newId)) { await ctx.reply('❌ Невірний формат. Введіть числовий Telegram ID'); return }
      await db.query(`INSERT INTO admins (chat_id, username, added_by) VALUES ($1, $2, $3) ON CONFLICT (chat_id) DO NOTHING`, [newId, '', userId])
      await redis.del(`admin_action:${userId}`)
      await ctx.reply(`✅ Адміна \`${newId}\` додано!`, { parse_mode: 'Markdown', reply_markup: adminMenu() })
      try { await bot.api.sendMessage(Number(newId), `✅ Вас додано як адміна бота *Respect Car*\n\nНатисніть /admin для входу в панель`, { parse_mode: 'Markdown' }) } catch {}
    }
  })
}
