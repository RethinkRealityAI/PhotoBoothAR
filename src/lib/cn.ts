/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * cn() — merge conditional class names, de-duplicating conflicting Tailwind
 * utilities so the last one wins (e.g. cn('p-2','p-4') → 'p-4'). Both deps are
 * already in package.json; this is the first place they're used.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
