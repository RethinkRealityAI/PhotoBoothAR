/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The landing page must surface the live demo and make its feature cards
 * clickable (they deep-link into the demo / signup). These tests guard that the
 * marketing entry points don't regress back to static, dead cards.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Landing from './Landing';
import { DEMO } from './Demo';

function renderLanding() {
  return render(
    <MemoryRouter>
      <Landing />
    </MemoryRouter>,
  );
}

describe('Landing', () => {
  it('surfaces the live demo (at least one /demo link)', () => {
    renderLanding();
    const demoLinks = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/demo');
    expect(demoLinks.length).toBeGreaterThanOrEqual(1);
  });

  it('makes the feature cards clickable into the demo / signup', () => {
    renderLanding();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain(DEMO.booth);
    expect(hrefs).toContain(DEMO.finishedCard);
    expect(hrefs).toContain('/signup');
  });
});
