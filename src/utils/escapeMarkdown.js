module.exports = function escapeMarkdown(text = '') {
    return text
        .replace(/([_*[\]()~`>#+-=|{}.!\\])/g, '\\$1'); // Telegram MarkdownV2
};