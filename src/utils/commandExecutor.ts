/**
 * Утилита для выполнения команд в системе
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Выполнить команду в терминале
 * @param command Команда для выполнения
 * @param options Опции выполнения
 * @returns Результат выполнения команды
 */
export async function executeCommand(
  command: string,
  options?: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
  }
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: options?.cwd,
      env: options?.env || process.env,
      timeout: options?.timeout || 30000,
    });
    
    return { stdout, stderr };
  } catch (error: any) {
    // Если команда завершилась с ошибкой, возвращаем stdout и stderr
    return {
      stdout: error.stdout || '',
      stderr: error.stderr || error.message || '',
    };
  }
}
