/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';
import { User, Offer, Order, Review, SupportTicket } from '../types';
import type { PartnerNotification } from '../context/AppContext';

// =============================================================================
// Supabase client (replaces the old Firebase init). Shares the VitaChain
// Supabase project; every SecondServe table is namespaced `ss_`.
// =============================================================================
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local',
  );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Kept for source compatibility with the previous Firebase error helper.
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleSupabaseError(error: unknown, operationType: OperationType, path: string | null): never {
  const info = {
    error: error instanceof Error ? error.message : JSON.stringify(error),
    operationType,
    path,
  };
  console.error('Supabase Error: ', JSON.stringify(info));
  throw new Error(JSON.stringify(info));
}

// =============================================================================
// Row <-> entity mappers. The DB is snake_case; the whole app speaks camelCase
// (types.ts). These keep the page/component code untouched.
// =============================================================================
type Row = Record<string, any>;

const coords = (lat: any, lng: any) =>
  lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : undefined;

export function rowToUser(r: Row): User {
  return {
    id: r.id,
    role: r.role,
    email: r.email,
    name: r.name,
    city: r.city ?? '',
    approved: r.approved ?? undefined,
    banned: r.banned ?? undefined,
    commerceType: r.commerce_type ?? undefined,
    address: r.address ?? undefined,
    phone: r.phone ?? undefined,
    coordinates: coords(r.lat, r.lng),
    mapLink: r.map_link ?? undefined,
  };
}

export function rowToOffer(r: Row): Offer {
  return {
    id: r.id,
    restaurantId: r.restaurant_id,
    restaurantName: r.restaurant_name,
    name: r.name,
    description: r.description,
    originalPrice: r.original_price,
    reducedPrice: r.reduced_price,
    quantity: r.quantity,
    image: r.image,
    timeLimit: r.time_limit,
    city: r.city,
    commerceType: r.commerce_type,
    mealCategory: r.meal_category ?? undefined,
    rating: r.rating ?? undefined,
    isSurpriseBox: r.is_surprise_box ?? undefined,
    address: r.address ?? undefined,
    coordinates: coords(r.lat, r.lng),
    mapLink: r.map_link ?? undefined,
  };
}

export function offerToRow(o: Partial<Offer>): Row {
  return {
    restaurant_id: o.restaurantId,
    restaurant_name: o.restaurantName,
    name: o.name,
    description: o.description ?? '',
    original_price: Number(o.originalPrice) || 0,
    reduced_price: Number(o.reducedPrice) || 0,
    quantity: Number(o.quantity) || 0,
    image: o.image ?? '',
    time_limit: o.timeLimit ?? '',
    city: o.city ?? '',
    commerce_type: o.commerceType ?? '',
    meal_category: o.mealCategory ?? null,
    rating: o.rating ?? null,
    is_surprise_box: !!o.isSurpriseBox,
    address: o.address ?? null,
    lat: o.coordinates?.lat ?? null,
    lng: o.coordinates?.lng ?? null,
    map_link: o.mapLink ?? null,
  };
}

export function rowToOrder(r: Row): Order {
  return {
    id: r.id,
    offerId: r.offer_id,
    consumerId: r.consumer_id,
    consumerName: r.consumer_name ?? undefined,
    consumerPhone: r.consumer_phone ?? undefined,
    restaurantId: r.restaurant_id,
    quantity: r.quantity,
    totalPrice: Number(r.total_price),
    status: r.status,
    createdAt: r.created_at,
    offerSnapshot: r.offer_snapshot as Offer,
    paymentMethod: r.payment_method ?? undefined,
    paymentStatus: r.payment_status ?? undefined,
    customerMessage: r.customer_message ?? undefined,
    pickupCode: r.pickup_code ?? undefined,
    expiresAt: r.expires_at ?? undefined,
  };
}

export function rowToReview(r: Row): Review {
  return {
    id: r.id,
    offerId: r.offer_id,
    consumerId: r.consumer_id,
    consumerName: r.consumer_name,
    restaurantId: r.restaurant_id,
    rating: r.rating,
    comment: r.comment,
    createdAt: r.created_at,
  };
}

export function rowToNotification(r: Row): PartnerNotification {
  return {
    id: r.id,
    orderId: r.order_id,
    customerName: r.customer_name,
    offerName: r.offer_name,
    totalPrice: Number(r.total_price),
    paymentMethod: r.payment_method,
    createdAt: r.created_at,
    read: r.read,
    recipientId: r.recipient_id,
  };
}

export function rowToTicket(r: Row): SupportTicket {
  return {
    id: r.id,
    userId: r.user_id,
    userEmail: r.user_email,
    userName: r.user_name,
    userRole: r.user_role,
    subject: r.subject,
    message: r.message,
    status: r.status,
    response: r.response ?? undefined,
    createdAt: r.created_at,
  };
}

// =============================================================================
// Small query helpers used by the page components (kept tiny so page diffs are
// minimal). AppContext owns the realtime lists and mutations.
// =============================================================================
export async function fetchOfferById(id: string): Promise<Offer | null> {
  const { data, error } = await supabase.from('ss_offers').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? rowToOffer(data) : null;
}

export async function fetchOrderById(id: string): Promise<Order | null> {
  const { data, error } = await supabase.from('ss_orders').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? rowToOrder(data) : null;
}

/** Insert (id omitted → DB uuid) or update an offer. Returns the saved offer. */
export async function saveOffer(offer: Offer, isNew: boolean): Promise<Offer> {
  const row = offerToRow(offer);
  if (isNew) {
    const { data, error } = await supabase.from('ss_offers').insert(row).select('*').single();
    if (error) throw error;
    return rowToOffer(data);
  }
  const { data, error } = await supabase.from('ss_offers').update(row).eq('id', offer.id).select('*').single();
  if (error) throw error;
  return rowToOffer(data);
}

export async function deleteOffer(id: string): Promise<void> {
  const { error } = await supabase.from('ss_offers').delete().eq('id', id);
  if (error) throw error;
}

// =============================================================================
// Cross-app profile resolution (shared VitaChain auth pool).
//
// Citizen and restaurant identities are shared between VitaChain and
// SecondServe, so a VitaChain account that has never used SecondServe is
// provisioned a consumer profile on first login. VitaChain FARMER accounts are
// NOT allowed on SecondServe — they are rejected here (and at the DB level by
// the ss_profiles INSERT policy, migration 0004).
//
// Centralised so the login handler AND the session-restore listener behave
// identically — previously only login auto-provisioned, so a restored session
// with no ss_profiles row silently produced a logged-in-but-profile-less state.
// =============================================================================
export class SsFarmerBlockedError extends Error {
  constructor() {
    super('FARMER_NOT_ALLOWED_ON_SECONDSERVE');
    this.name = 'SsFarmerBlockedError';
  }
}

/**
 * Returns the caller's SecondServe profile, provisioning a consumer profile on
 * the fly for shared (citizen/restaurant) VitaChain accounts. Throws
 * SsFarmerBlockedError for VitaChain FARMER accounts.
 */
export async function ensureSsProfile(userId: string, email: string): Promise<User> {
  // 1. Already a SecondServe user → done. (Native ss signups land here.)
  const { data: existing } = await supabase
    .from('ss_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (existing) return rowToUser(existing);

  // 2. No ss_profiles row → this is a VitaChain-origin account. Map its role:
  //    FARMER is barred; RESTAURANT becomes a SecondServe partner (pending
  //    SecondServe approval); everyone else (CITIZEN/ADMIN) becomes a consumer.
  const { data: vc } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (vc?.role === 'FARMER') throw new SsFarmerBlockedError();

  const ssRole: 'consumer' | 'restaurant' =
    vc?.role === 'RESTAURANT' ? 'restaurant' : 'consumer';

  // 3. Provision the profile. The ss_profiles INSERT policy requires
  //    consumer→approved=true and restaurant→approved=false, so a shared
  //    restaurant lands unapproved until a SecondServe admin validates it
  //    (their dashboard works; their offers stay hidden until then).
  const fallback = {
    id: userId,
    role: ssRole,
    email,
    name: email.split('@')[0],
    city: 'Casablanca',
    approved: ssRole === 'consumer',
    banned: false,
  };
  const { data: inserted, error } = await supabase
    .from('ss_profiles')
    .insert(fallback)
    .select('*')
    .single();
  if (error) throw error;
  return rowToUser(inserted ?? fallback);
}
