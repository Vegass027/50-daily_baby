/**
 * Форматирует ошибки в понятные для пользователя сообщения
 */
export class ErrorFormatter {
  /**
   * Преобразует техническую ошибку в понятное сообщение для пользователя
   */
  static formatUserFriendly(error: any): string {
    const errorMessage = error?.message || String(error);
    
    // RPC errors
    if (errorMessage.includes('429')) {
      return '⏱️ Слишком много запросов. Попробуйте через несколько секунд.';
    }
    
    if (errorMessage.includes('insufficient funds') || errorMessage.includes('Insufficient balance')) {
      return '💰 Недостаточно средств на балансе.';
    }
    
    if (errorMessage.includes('blockhash not found')) {
      return '🔄 Сеть перегружена. Транзакция не прошла - попробуйте еще раз.';
    }
    
    if (errorMessage.includes('slippage')) {
      return '📉 Проскальзывание слишком большое. Увеличьте slippage или попробуйте позже.';
    }
    
    // Token errors
    if (errorMessage.includes('token account not found')) {
      return '🪙 Токен не найден. Проверьте адрес.';
    }
    
    // Network errors
    if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
      return '🌐 Таймаут сети. Попробуйте еще раз.';
    }
    
    if (errorMessage.includes('network') || errorMessage.includes('ENOTFOUND')) {
      return '🌐 Ошибка сети. Проверьте подключение.';
    }
    
    // Jito errors
    if (errorMessage.includes('jito') || errorMessage.includes('bundle')) {
      return '⚡ Ошибка Jito bundle. Попытка отправки через обычный RPC...';
    }
    
    // Default
    if (errorMessage.length > 100) {
      return `❌ Ошибка: ${errorMessage.substring(0, 97)}...`;
    }
    
    return `❌ Ошибка: ${errorMessage}`;
  }
}
