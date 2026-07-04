/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The demo hub is the front door to the no-sign-in sandbox; if a card's link
 * drifts from its seeded record the whole demo dead-ends. These tests lock the
 * four feature deep-links and the home / create-event affordances.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Demo, { DEMO } from './Demo';

function renderDemo() {
  return render(
    <MemoryRouter>
      <Demo />
    </MemoryRouter>,
  );
}

describe('Demo hub', () => {
  it('deep-links each feature card to its live demo flow', () => {
    renderDemo();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(
      expect.arrayContaining([DEMO.booth, DEMO.wall, DEMO.finishedCard, DEMO.contribute]),
    );
  });

  it('shows all four feature titles', () => {
    renderDemo();
    expect(screen.getByText('The AR photo booth')).toBeInTheDocument();
    expect(screen.getByText('The live wall')).toBeInTheDocument();
    expect(screen.getByText('A finished greeting card')).toBeInTheDocument();
    expect(screen.getByText('Contribute to a card')).toBeInTheDocument();
  });

  it('offers a way home and a way to create an event', () => {
    renderDemo();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/'); // Home
    expect(hrefs).toContain('/signup'); // Create your event
  });
});
