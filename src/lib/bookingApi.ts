/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * I/O half of booking links (pure model: booking.ts). Same contract as
 * crmApi.ts: every call resolves `{ data, error }` and never throws; `error`
 * is a sentence safe to show. Postgres (migration 042) is the gate.
 */
import { supabase } from './supabase';
import {
  friendlyBookingError, normalizeSettings,
  type Booking, type BookingConfirmation, type BookingSettings, type BookingStatus, type BookerDraft,
  type PublicBookingPage,
} from './booking';
import type { CrmErrorLike } from './crm';
import type { CrmResult } from './crmApi';

function fail<T>(err: CrmErrorLike | null | undefined, where: string): CrmResult<T> {
  console.error(`[booking] ${where}`, err);
  return { data: null, error: friendlyBookingError(err) };
}

async function guard<T>(where: string, run: () => Promise<CrmResult<T>>): Promise<CrmResult<T>> {
  try {
    return await run();
  } catch (e) {
    return fail<T>({ message: e instanceof Error ? e.message : String(e) }, where);
  }
}

/** Missing function/table = 042 not applied yet. The UI says so plainly. */
export function isNotSetUp(err: CrmErrorLike | null | undefined): boolean {
  const code = err?.code ?? '';
  return code === '42P01' || code === '42883' || code === 'PGRST202' || code === 'PGRST205';
}

// ── Public (anon) ──────────────────────────────────────────────────────────

/** null data + null error = no such (enabled) page. */
export function fetchPublicBookingPage(ref: string): Promise<CrmResult<PublicBookingPage | null> & { notSetUp?: boolean }> {
  return guard('fetchPublicBookingPage', async () => {
    const { data, error } = await supabase.rpc('sales_booking_page_public', { p_ref: ref });
    if (error !== null) return { ...fail<PublicBookingPage | null>(error, 'fetchPublicBookingPage'), notSetUp: isNotSetUp(error) };
    if (data === null || typeof data !== 'object') return { data: null, error: null };
    const p = data as PublicBookingPage;
    return {
      data: {
        ...p,
        weekly: p.weekly !== null && typeof p.weekly === 'object' ? p.weekly : {},
        busy: Array.isArray(p.busy) ? p.busy : [],
      },
      error: null,
    };
  });
}

export function bookMeeting(
  ref: string,
  startIso: string,
  d: BookerDraft,
  bookerTz: string,
): Promise<CrmResult<BookingConfirmation>> {
  return guard('bookMeeting', async () => {
    const { data, error } = await supabase.rpc('sales_book_meeting', {
      p_ref: ref,
      p_starts_at: startIso,
      p_name: d.name.trim(),
      p_email: d.email.trim() === '' ? null : d.email.trim(),
      p_phone: d.phone.trim() === '' ? null : d.phone.trim(),
      p_company: d.company.trim() === '' ? null : d.company.trim(),
      p_icp: d.icp ?? 'other',
      p_event_date: d.eventDate === '' ? null : d.eventDate,
      p_notes: d.notes.trim() === '' ? null : d.notes.trim(),
      p_booker_tz: bookerTz,
      p_consent: d.consent,
    });
    if (error !== null) return fail(error, 'bookMeeting');
    return { data: data as BookingConfirmation, error: null };
  });
}

// ── Rep (signed in) ────────────────────────────────────────────────────────

/** data null + error null = the rep has no settings row yet. */
export function getMyBookingSettings(userId: string): Promise<CrmResult<BookingSettings | null> & { notSetUp?: boolean }> {
  return guard('getMyBookingSettings', async () => {
    const { data, error } = await supabase.from('sales_booking_pages').select('*').eq('user_id', userId).maybeSingle();
    if (error !== null) return { ...fail<BookingSettings | null>(error, 'getMyBookingSettings'), notSetUp: isNotSetUp(error) };
    return { data: data === null ? null : normalizeSettings(data as Record<string, unknown>), error: null };
  });
}

export function saveMyBookingSettings(s: BookingSettings): Promise<CrmResult<BookingSettings>> {
  return guard('saveMyBookingSettings', async () => {
    const row = {
      user_id: s.user_id,
      enabled: s.enabled,
      headline: s.headline,
      intro: s.intro,
      duration_min: s.duration_min,
      buffer_min: s.buffer_min,
      timezone: s.timezone,
      weekly: s.weekly,
      min_notice_hours: s.min_notice_hours,
      horizon_days: s.horizon_days,
      meeting_link: s.meeting_link,
      market: s.market,
    };
    const { data, error } = await supabase.from('sales_booking_pages').upsert(row, { onConflict: 'user_id' }).select('*').single();
    if (error !== null) return fail(error, 'saveMyBookingSettings');
    return { data: normalizeSettings(data as Record<string, unknown>), error: null };
  });
}

export function setMyRefCode(code: string): Promise<CrmResult<string>> {
  return guard('setMyRefCode', async () => {
    const { data, error } = await supabase.rpc('sales_set_my_ref_code', { p_code: code.trim().toLowerCase() });
    if (error !== null) return fail(error, 'setMyRefCode');
    return { data: String(data), error: null };
  });
}

const BOOKING_LIMIT = 300;

export function listBookings(): Promise<CrmResult<Booking[]> & { notSetUp?: boolean }> {
  return guard('listBookings', async () => {
    const { data, error } = await supabase
      .from('sales_bookings')
      .select('*')
      .order('starts_at', { ascending: false })
      .limit(BOOKING_LIMIT);
    if (error !== null) return { ...fail<Booking[]>(error, 'listBookings'), notSetUp: isNotSetUp(error) };
    return { data: (data ?? []) as Booking[], error: null };
  });
}

export function setBookingStatus(id: string, status: BookingStatus): Promise<CrmResult<Booking>> {
  return guard('setBookingStatus', async () => {
    const { data, error } = await supabase.from('sales_bookings').update({ status }).eq('id', id).select('*').single();
    if (error !== null) return fail(error, 'setBookingStatus');
    return { data: data as Booking, error: null };
  });
}
