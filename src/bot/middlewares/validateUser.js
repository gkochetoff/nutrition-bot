module.exports = async function validateUser(ctx, next) {
  if (!ctx.from || !ctx.from.id) {
    console.error('User validation failed: missing user data');
    return ctx.reply('Ошибка: не удалось определить пользователя.');
  }
  return next();
};

 