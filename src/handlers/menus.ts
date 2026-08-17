import { InlineKeyboard } from 'grammy'

export function mainMenu() {
  return new InlineKeyboard()
    .text('🚗 Продаж авто', 'prodazh').row()
    .text('💰 Викуп авто', 'vykup').row()
    .text('🇺🇸 Авто з США', 'ssha').row()
    .text('🏍 Мотоцикл', 'moto').row()
    .text('📞 Контакти', 'kontakty')
}

export function adminMenu() {
  return new InlineKeyboard()
    .text('🚗 Додати авто', 'admin_addcar').row()
    .text('✏️ Редагувати авто', 'admin_editcar').row()
    .text('🗑 Мої авто', 'admin_cars').row()
    .text('📋 Всі заявки', 'admin_list').row()
    .text('➕ Додати адміна', 'admin_add').row()
    .text('👥 Список адмінів', 'admin_admins')
}

export function categoryKeyboard() {
  return new InlineKeyboard()
    .text('🚗 Седан', 'cat:sedan').text('🚙 SUV', 'cat:suv').row()
    .text('🚐 Кросовер', 'cat:crossover').text('💎 Преміум', 'cat:premium')
}
