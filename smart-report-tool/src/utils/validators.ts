/**
 * Validate that a string is not empty after trimming.
 */
export function isNotEmpty(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate username: 3-20 chars, alphanumeric and underscore.
 */
export function isValidUsername(username: string): boolean {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

/**
 * Validate password: at least 4 chars.
 */
export function isValidPassword(password: string): boolean {
  return password.length >= 4;
}

/**
 * Validate email format.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Get validation error message for a required field.
 */
export function requiredError(fieldName: string): string {
  return `${fieldName}不能为空`;
}
