const { UserFacingError } = require('../errors');

const GENERIC_ERROR = 'حدث خطأ غير متوقع. حاول مرة أخرى';

// كل استجابة تُغلَّف بـ { ok, data | error } ليستطيع الجسر (preload) تمييز الأخطاء بوضوح
function handleSafely(ipcMain, channel, action) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return { ok: true, data: await action(event.sender.id, payload) };
    } catch (error) {
      if (error instanceof UserFacingError) return { ok: false, error: error.message };
      console.error(`[ipc ${channel}]`, error);
      return { ok: false, error: GENERIC_ERROR };
    }
  });
}

module.exports = { handleSafely };
