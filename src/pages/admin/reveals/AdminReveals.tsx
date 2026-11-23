/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /admin/reveals — Beamwall's marketing reveals, inside AdminLayout (which
 * owns the admin gate). Each card opens the full-viewport editor at
 * /admin/reveals/:id.
 */
import { usePageTitle } from '../../../lib/usePageTitle';
import { createReveal, listReveals } from '../../../lib/reveals/revealApi';
import RevealsListView from './RevealsListView';

const editorPath = (id: string) => `/admin/reveals/${encodeURIComponent(id)}`;

export default function AdminReveals() {
  usePageTitle('Reveals — Beamwall admin');
  return <RevealsListView load={listReveals} create={createReveal} editorPath={editorPath} />;
}
