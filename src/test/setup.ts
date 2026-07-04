/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Vitest global setup. Registers @testing-library/jest-dom matchers
 * (toBeInTheDocument, toHaveAttribute, …) and unmounts rendered React trees
 * after each test. The explicit cleanup is required because Testing Library only
 * auto-registers its afterEach hook when Vitest `globals` is on (it isn't here,
 * to match the existing explicit-import test style). Safe in the Node suite too.
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});
