/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Thin I/O half of the partnerships CRM — the pure model is crm.ts.
 *
 * Every call resolves `{ data, error }` and never throws: `error` is already a
 * user-facing sentence (crm.friendlyCrmError), so the UI can toast it as-is.
 * Authorization lives in Postgres (041 RLS + the definer RPCs); nothing here is
 * a security boundary, it only keeps the UI honest about what happened.
 */
import { supabase } from './supabase';
import {
  applyCollateral, friendlyCrmError, isTouchKind, type Activity, type ActivityKind, type CrmErrorLike,
  type Prospect, type ProspectWrite, type TeamMember,
} from './crm';

export interface CrmResult<T> {
  data: T | null;
  /** null on success, else a sentence safe to show. */
  error: string | null;
}

function fail<T>(err: CrmErrorLike | null | undefined, where: string): CrmResult<T> {
  console.error(`[crm] ${where}`, err);
  return { data: null, error: friendlyCrmError(err) };
}

/** Wrap an awaited query so a thrown fetch (offline) still resolves. */
async function guard<T>(where: string, run: () => Promise<CrmResult<T>>): Promise<CrmResult<T>> {
  try {
    return await run();
  } catch (e) {
    return fail<T>({ message: e instanceof Error ? e.message : String(e) }, where);
  }
}

/** PostgREST hands jsonb back as-is; make the object columns total. */
function normalizeProspect(row: Record<string, unknown>): Prospect {
  const r = row as unknown as Prospect;
  return {
    ...r,
    socials: r.socials !== null && typeof r.socials === 'object' ? r.socials : {},
    collateral: r.collateral !== null && typeof r.collateral === 'object' ? r.collateral : {},
    tags: Array.isArray(r.tags) ? r.tags : [],
  };
}

const PROSPECT_LIMIT = 2000;

// ── Prospects ──────────────────────────────────────────────────────────────

export function listProspects(): Promise<CrmResult<Prospect[]>> {
  return guard('listProspects', async () => {
    const { data, error } = await supabase
      .from('sales_prospects')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(PROSPECT_LIMIT);
    if (error !== null) return fail(error, 'listProspects');
    return { data: (data ?? []).map((r) => normalizeProspect(r as Record<string, unknown>)), error: null };
  });
}

export function createProspect(payload: ProspectWrite): Promise<CrmResult<Prospect>> {
  return guard('createProspect', async () => {
    const { data, error } = await supabase.from('sales_prospects').insert(payload).select('*').single();
    if (error !== null) return fail(error, 'createProspect');
    return { data: normalizeProspect(data as Record<string, unknown>), error: null };
  });
}

/** Columns a client may patch. owner_id only takes effect for platform admins (RLS WITH CHECK). */
export type ProspectPatch = Partial<ProspectWrite> & {
  collateral?: Record<string, string>;
  last_contacted_at?: string | null;
  owner_id?: string | null;
};

/**
 * Update and return the fresh row. An RLS-filtered UPDATE matches zero rows
 * rather than erroring, so `.single()` turns "not yours" into PGRST116 — which
 * friendlyCrmError words as "isn't yours to change".
 */
export function updateProspect(id: string, patch: ProspectPatch): Promise<CrmResult<Prospect>> {
  return guard('updateProspect', async () => {
    const { data, error } = await supabase
      .from('sales_prospects')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();
    if (error !== null) return fail(error, 'updateProspect');
    return { data: normalizeProspect(data as Record<string, unknown>), error: null };
  });
}

export function deleteProspect(id: string): Promise<CrmResult<true>> {
  return guard('deleteProspect', async () => {
    const { data, error } = await supabase.from('sales_prospects').delete().eq('id', id).select('id');
    if (error !== null) return fail(error, 'deleteProspect');
    // RLS filters the DELETE silently — zero rows back means nothing was removed.
    if ((data ?? []).length === 0) return fail({ code: 'PGRST116' }, 'deleteProspect');
    return { data: true, error: null };
  });
}

// ── Activities ─────────────────────────────────────────────────────────────

export function listActivities(prospectId: string): Promise<CrmResult<Activity[]>> {
  return guard('listActivities', async () => {
    const { data, error } = await supabase
      .from('sales_activities')
      .select('*')
      .eq('prospect_id', prospectId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error !== null) return fail(error, 'listActivities');
    return { data: (data ?? []) as Activity[], error: null };
  });
}

/** My own activities at or after `iso` — feeds the daily touch counter. */
export function listMyActivitiesSince(iso: string): Promise<CrmResult<Activity[]>> {
  return guard('listMyActivitiesSince', async () => {
    const { data: sess } = await supabase.auth.getSession();
    const uid = sess.session?.user?.id;
    if (uid === undefined) return fail({ code: 'PGRST301' }, 'listMyActivitiesSince');
    const { data, error } = await supabase
      .from('sales_activities')
      .select('*')
      .eq('actor_id', uid)
      .gte('created_at', iso)
      .order('created_at', { ascending: false })
      .limit(1000);
    if (error !== null) return fail(error, 'listMyActivitiesSince');
    return { data: (data ?? []) as Activity[], error: null };
  });
}

export interface LoggedActivity {
  activity: Activity;
  /** The new last_contacted_at, or null when the bump was not attempted or failed
   *  (a rep may log on a teammate's prospect — RLS lets them insert the activity
   *  but not edit the row, so a failed bump must not undo the logged touch). */
  lastContactedAt: string | null;
}

export function logActivity(
  prospectId: string,
  kind: ActivityKind,
  channel?: string | null,
  body?: string | null,
): Promise<CrmResult<LoggedActivity>> {
  return guard('logActivity', async () => {
    const row = {
      prospect_id: prospectId,
      kind,
      channel: channel !== undefined && channel !== null && channel.trim() !== '' ? channel.trim().slice(0, 40) : null,
      body: body !== undefined && body !== null && body.trim() !== '' ? body.trim().slice(0, 4000) : null,
    };
    const { data, error } = await supabase.from('sales_activities').insert(row).select('*').single();
    if (error !== null) return fail(error, 'logActivity');
    const activity = data as Activity;
    let lastContactedAt: string | null = null;
    if (isTouchKind(kind)) {
      const { data: bumped, error: bumpErr } = await supabase
        .from('sales_prospects')
        .update({ last_contacted_at: activity.created_at })
        .eq('id', prospectId)
        .select('last_contacted_at');
      if (bumpErr !== null) console.warn('[crm] last_contacted_at bump failed', bumpErr);
      else if ((bumped ?? []).length > 0) lastContactedAt = activity.created_at;
    }
    return { data: { activity, lastContactedAt }, error: null };
  });
}

// ── Collateral ─────────────────────────────────────────────────────────────

/**
 * Tick / untick one collateral item. Read-modify-write on the CURRENT row, not
 * on the caller's possibly-stale copy, so a teammate's tick from another tab
 * is not clobbered. (A truly simultaneous write in the gap between the read
 * and the update can still lose one tick — acceptable for a checklist.)
 */
export function toggleCollateral(
  prospect: Pick<Prospect, 'id'>,
  collateralId: string,
  sent: boolean,
): Promise<CrmResult<Prospect>> {
  return guard('toggleCollateral', async () => {
    const { data: cur, error: readErr } = await supabase
      .from('sales_prospects')
      .select('collateral')
      .eq('id', prospect.id)
      .single();
    if (readErr !== null) return fail(readErr, 'toggleCollateral.read');
    const current = (cur as { collateral: Record<string, string> | null }).collateral;
    const next = applyCollateral(current, collateralId, sent, new Date().toISOString());
    return updateProspect(prospect.id, { collateral: next });
  });
}

// ── Roster ─────────────────────────────────────────────────────────────────

export function isSalesMember(): Promise<CrmResult<boolean>> {
  return guard('isSalesMember', async () => {
    const { data, error } = await supabase.rpc('is_sales_member');
    if (error !== null) return fail(error, 'isSalesMember');
    return { data: data === true, error: null };
  });
}

export function teamList(): Promise<CrmResult<TeamMember[]>> {
  return guard('teamList', async () => {
    const { data, error } = await supabase.rpc('sales_team_list');
    if (error !== null) return fail(error, 'teamList');
    return { data: (Array.isArray(data) ? data : []) as TeamMember[], error: null };
  });
}

export function grantAccess(email: string, role: 'rep' | 'manager', refCode: string | null): Promise<CrmResult<string>> {
  return guard('grantAccess', async () => {
    const code = (refCode ?? '').trim().toLowerCase();
    const { data, error } = await supabase.rpc('sales_grant_access', {
      p_email: email.trim(),
      p_role: role,
      p_ref_code: code === '' ? null : code,
    });
    if (error !== null) return fail(error, 'grantAccess');
    return { data: String(data), error: null };
  });
}

export function revokeAccess(userId: string): Promise<CrmResult<true>> {
  return guard('revokeAccess', async () => {
    const { error } = await supabase.rpc('sales_revoke_access', { p_user: userId });
    if (error !== null) return fail(error, 'revokeAccess');
    return { data: true, error: null };
  });
}
