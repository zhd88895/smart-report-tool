import { format, parseISO, isValid } from 'date-fns';
import { zhCN } from 'date-fns/locale';

function safeParseDate(date: string | Date | null | undefined): Date | null {
  if (!date) return null;
  if (date instanceof Date) return isValid(date) ? date : null;
  if (typeof date !== 'string') return null;
  const trimmed = date.trim();
  if (!trimmed) return null;
  const d = parseISO(trimmed);
  return isValid(d) ? d : null;
}

/**
 * Format a date string or Date to a readable format.
 */
export function formatDate(date: string | Date | null | undefined, pattern = 'yyyy-MM-dd HH:mm'): string {
  const d = safeParseDate(date);
  if (!d) return '-';
  return format(d, pattern, { locale: zhCN });
}

/**
 * Format a date to YYYY-MM-DD.
 */
export function formatDateShort(date: string | Date | null | undefined): string {
  const d = safeParseDate(date);
  if (!d) return '-';
  return format(d, 'yyyy-MM-dd', { locale: zhCN });
}

/**
 * Format file size to human-readable string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Get current date string in YYYY-MM-DD format.
 */
export function getTodayString(): string {
  return format(new Date(), 'yyyy-MM-dd');
}
