import React, { createContext, useContext, useState, ReactNode, useEffect, useRef } from 'react';
import { User, City, Offer, Order, Coordinates, Review, SupportTicket } from '../types';
import { toast } from 'sonner';
import { translations, TranslationKeys } from '../lib/translations';
import {
  supabase,
  rowToUser,
  rowToOffer,
  rowToOrder,
  rowToReview,
  rowToNotification,
  rowToTicket,
  ensureSsProfile,
  SsFarmerBlockedError,
} from '../lib/supabase';

export interface PartnerNotification {
  id: string;
  orderId: string;
  customerName: string;
  offerName: string;
  totalPrice: number;
  paymentMethod: 'online' | 'delivery';
  createdAt: string;
  read: boolean;
  recipientId: string;
}

interface AppContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  selectedCity: City;
  setSelectedCity: (city: City) => void;
  offers: Offer[];
  setOffers: React.Dispatch<React.SetStateAction<Offer[]>>;
  orders: Order[];
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  reviews: Review[];
  setReviews: React.Dispatch<React.SetStateAction<Review[]>>;
  addReview: (review: Omit<Review, 'id' | 'createdAt'>) => Promise<void>;
  favorites: string[];
  toggleFavorite: (offerId: string) => void;
  placeOrder: (
    offer: Offer,
    quantity: number,
    extra?: {
      consumerName?: string;
      consumerPhone?: string;
      customerMessage?: string;
      paymentMethod?: 'online' | 'delivery';
      paymentStatus?: 'pending' | 'successful' | 'failed' | 'released';
    }
  ) => Promise<string | null>;
  cancelOrder: (orderId: string) => Promise<void>;
  confirmCodPayment: (orderId: string) => Promise<void>;
  updateOrderStatus: (orderId: string, status: Order['status']) => Promise<void>;
  userLocation: Coordinates | null;
  setUserLocation: (coords: Coordinates | null) => void;
  language: 'en' | 'ar' | 'fr';
  setLanguage: (lang: 'en' | 'ar' | 'fr') => void;
  t: (key: keyof TranslationKeys) => string;
  notifications: PartnerNotification[];
  setNotifications: React.Dispatch<React.SetStateAction<PartnerNotification[]>>;
  markNotificationAsRead: (id: string) => Promise<void>;
  clearAllNotifications: () => Promise<void>;
  users: User[];
  setUsers: React.Dispatch<React.SetStateAction<User[]>>;
  banUser: (userId: string) => Promise<void>;
  unbanUser: (userId: string) => Promise<void>;
  deleteUser: (userId: string) => Promise<void>;
  approvePartner: (partnerId: string) => Promise<void>;
  rejectPartner: (partnerId: string) => Promise<void>;
  supportTickets: SupportTicket[];
  addSupportTicket: (subject: string, message: string) => Promise<void>;
  resolveSupportTicket: (ticketId: string, response: string) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function computePickupExpiry(timeLimit: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeLimit || '');
  const now = new Date();
  const expiry = new Date(now);
  if (match) {
    expiry.setHours(Number(match[1]), Number(match[2]), 0, 0);
    if (expiry <= now) expiry.setDate(expiry.getDate() + 1);
  } else {
    expiry.setHours(now.getHours() + 24);
  }
  return expiry.toISOString();
}

export function isOrderExpired(order: { status: string; expiresAt?: string }): boolean {
  if (order.status !== 'active' || !order.expiresAt) return false;
  return new Date(order.expiresAt).getTime() < Date.now();
}

export function playNotificationChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const playNote = (time: number, freq: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(0.15, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + duration);
    };
    const now = ctx.currentTime;
    playNote(now, 587.33, 0.35);
    playNote(now + 0.1, 783.99, 0.45);
  } catch (e) {
    console.error('Audio notification failed:', e);
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(() => {
    const saved = localStorage.getItem('ss_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [selectedCity, setSelectedCityState] = useState<City>(() => {
    return (localStorage.getItem('ss_selected_city') as City) || 'Casablanca';
  });

  const [offers, setOffersState] = useState<Offer[]>([]);
  const [orders, setOrdersState] = useState<Order[]>([]);
  const [reviews, setReviewsState] = useState<Review[]>([]);
  const [favorites, setFavorites] = useState<string[]>(() => {
    const saved = localStorage.getItem('ss_favorites');
    return saved ? JSON.parse(saved) : [];
  });
  const [language, setLanguageState] = useState<'en' | 'ar' | 'fr'>(() => {
    const saved = localStorage.getItem('ss_language');
    if (saved === 'en' || saved === 'ar' || saved === 'fr') return saved;
    if (navigator.language?.startsWith('ar')) return 'ar';
    if (navigator.language?.startsWith('fr')) return 'fr';
    return 'en';
  });
  const [notifications, setNotifications] = useState<PartnerNotification[]>([]);
  const notifiedIDsRef = useRef<Set<string>>(new Set());
  const [userLocation, setUserLocation] = useState<Coordinates | null>(null);
  const [users, setUsersState] = useState<User[]>([]);
  const [supportTickets, setSupportTicketsState] = useState<SupportTicket[]>([]);

  useEffect(() => {
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
    document.documentElement.classList.toggle('rtl', language === 'ar');
  }, [language]);

  const setLanguage = (lang: 'en' | 'ar' | 'fr') => {
    setLanguageState(lang);
    localStorage.setItem('ss_language', lang);
    // Logged-in users: persist the choice to their account so it follows them
    // to any device/browser, not just this one (profiles.locale is the source
    // of truth once authenticated — see loadProfile below).
    if (user) {
      void supabase.from('ss_profiles').update({ locale: lang }).eq('id', user.id);
    }
  };

  const t = (key: keyof TranslationKeys): string => {
    return translations[language][key] || translations['en'][key] || String(key);
  };

  const setUser = (u: User | null) => {
    setUserState(u);
    if (u) localStorage.setItem('ss_user', JSON.stringify(u));
    else localStorage.removeItem('ss_user');
  };

  const setSelectedCity = (c: City) => {
    setSelectedCityState(c);
    localStorage.setItem('ss_selected_city', c);
  };

  const setOffers = (update: React.SetStateAction<Offer[]>) => setOffersState(update);
  const setOrders = (update: React.SetStateAction<Order[]>) => setOrdersState(update);
  const setReviews = (update: React.SetStateAction<Review[]>) => setReviewsState(update);
  const setUsers = (update: React.SetStateAction<User[]>) => setUsersState(update);

  useEffect(() => {
    localStorage.setItem('ss_favorites', JSON.stringify(favorites));
  }, [favorites]);

  // Supabase auth session listener (replaces Firebase onAuthStateChanged).
  useEffect(() => {
    const loadProfile = async (uid: string, email: string) => {
      try {
        // Resolve (or provision) the profile — same path as explicit login, so
        // a restored session behaves identically to a fresh sign-in.
        const profile = await ensureSsProfile(uid, email);
        if (profile.banned) {
          await supabase.auth.signOut();
          setUser(null);
          toast.error(t('suspendedAccountToast'));
          return;
        }
        setUser(profile);
        // Account locale is the source of truth once logged in — overrides
        // whatever this browser had in localStorage (see setLanguage above
        // for the write-back path when the user switches language in-app).
        if (profile.locale && profile.locale !== language) {
          setLanguageState(profile.locale);
          localStorage.setItem('ss_language', profile.locale);
        }
      } catch (err) {
        if (err instanceof SsFarmerBlockedError) {
          // VitaChain farmer with a live session in this tab — not allowed here.
          await supabase.auth.signOut();
          setUser(null);
          toast.error(t('farmerBlockedToast'));
          return;
        }
        console.error('Auth profile load error:', err);
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        void loadProfile(session.user.id, session.user.email ?? '');
      } else {
        setUserState(null);
        localStorage.removeItem('ss_user');
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // Real-time: Offers (world-readable). Firestore onSnapshot → Supabase channel.
  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase.from('ss_offers').select('*');
      if (error) { console.error('Offers load error:', error); return; }
      setOffersState((data || []).map(rowToOffer));
    };
    void load();
    const ch = supabase
      .channel('rt-ss_offers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ss_offers' }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  // Real-time: Reviews (world-readable).
  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase.from('ss_reviews').select('*');
      if (error) { console.error('Reviews load error:', error); return; }
      setReviewsState((data || []).map(rowToReview));
    };
    void load();
    const ch = supabase
      .channel('rt-ss_reviews')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ss_reviews' }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, []);

  // Real-time: Support tickets (RLS returns own rows, or all for admin).
  useEffect(() => {
    if (!user) { setSupportTicketsState([]); return; }
    const load = async () => {
      const { data, error } = await supabase
        .from('ss_support_tickets')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) { console.error('Support tickets load error:', error); return; }
      setSupportTicketsState((data || []).map(rowToTicket));
    };
    void load();
    const ch = supabase
      .channel('rt-ss_support_tickets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ss_support_tickets' }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [user]);

  // Real-time: Orders (RLS scopes to consumer / restaurant / admin).
  useEffect(() => {
    if (!user) { setOrdersState([]); return; }
    const load = async () => {
      const { data, error } = await supabase
        .from('ss_orders')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) { console.error('Orders load error:', error); return; }
      setOrdersState((data || []).map(rowToOrder));
    };
    void load();
    const ch = supabase
      .channel('rt-ss_orders')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ss_orders' }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [user]);

  // Real-time: Users. RLS already restricts:
  //   logged-out / consumer → approved, non-banned restaurants (+ self)
  //   admin                 → everyone
  useEffect(() => {
    const load = async () => {
      const { data, error } = await supabase.from('ss_profiles').select('*');
      if (error) { console.error('Users load error:', error); return; }
      setUsersState((data || []).map(rowToUser));
    };
    void load();
    const ch = supabase
      .channel('rt-ss_profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ss_profiles' }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [user]);

  // Real-time: Notifications (partners only).
  useEffect(() => {
    if (!user || user.role !== 'restaurant') { setNotifications([]); return; }
    let isFirstLoad = true;
    const load = async () => {
      const { data, error } = await supabase
        .from('ss_notifications')
        .select('*')
        .eq('recipient_id', user.id)
        .order('created_at', { ascending: false });
      if (error) { console.error('Notifications load error:', error); return; }
      const liveNotifs = (data || []).map(rowToNotification);

      const newUnreads = liveNotifs.filter(n => !n.read && !notifiedIDsRef.current.has(n.id));
      if (newUnreads.length > 0) {
        newUnreads.forEach(n => notifiedIDsRef.current.add(n.id));
        if (!isFirstLoad) {
          playNotificationChime();
          const newest = newUnreads[0];
          toast.custom((tId) => (
            <div className="bg-slate-900 text-white rounded-3xl p-5 shadow-2xl border border-slate-800 max-w-sm flex flex-col gap-2">
              <div className="flex justify-between items-start">
                <span className="font-extrabold text-sm text-primary tracking-wide">🚨 New Order!</span>
                <button onClick={() => toast.dismiss(tId)} className="text-gray-400 hover:text-white text-xs">✕</button>
              </div>
              <p className="text-xs text-gray-300 leading-relaxed font-semibold">
                New order for {newest.offerName} from {newest.customerName} — {newest.totalPrice} MAD
              </p>
            </div>
          ), { duration: 8000 });
        }
      }
      liveNotifs.forEach(n => { if (n.read) notifiedIDsRef.current.add(n.id); });
      isFirstLoad = false;
      setNotifications(liveNotifs);
    };
    void load();
    const ch = supabase
      .channel('rt-ss_notifications')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ss_notifications', filter: `recipient_id=eq.${user.id}` },
        () => void load(),
      )
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [user]);

  // Geolocation
  useEffect(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => console.error('Geolocation error:', err)
      );
    }
  }, []);

  const toggleFavorite = (offerId: string) => {
    if (!user) { toast.error(t('loginToFavoriteToast')); return; }
    setFavorites(prev => prev.includes(offerId) ? prev.filter(id => id !== offerId) : [...prev, offerId]);
  };

  // Atomic stock-check + order + notification via the ss_place_order RPC.
  // (Firestore had the consumer decrement offer stock directly, which the
  // security rules actually forbid — the RPC fixes that as SECURITY DEFINER.)
  const placeOrder = async (
    offer: Offer,
    quantity: number,
    extra?: {
      consumerName?: string;
      consumerPhone?: string;
      customerMessage?: string;
      paymentMethod?: 'online' | 'delivery';
      paymentStatus?: 'pending' | 'successful' | 'failed' | 'released';
    }
  ): Promise<string | null> => {
    if (!user) { toast.error(t('loginToOrderToast')); return null; }

    const { data, error } = await supabase.rpc('ss_place_order', {
      p_offer_id: offer.id,
      p_quantity: quantity,
      p_consumer_name: extra?.consumerName ?? user.name,
      p_consumer_phone: extra?.consumerPhone ?? user.phone ?? '0600000000',
      p_customer_message: extra?.customerMessage ?? '',
      p_payment_method: extra?.paymentMethod ?? 'delivery',
      p_payment_status: extra?.paymentStatus ?? 'pending',
    });

    if (error) {
      console.error('placeOrder error:', error);
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('not available')) toast.error(t('qtyNotAvailableToast'));
      else if (msg.includes('no longer exists')) toast.error(t('offerGoneToast'));
      else toast.error(t('placeOrderGenericErrToast'));
      return null;
    }

    playNotificationChime();
    return (data as string) ?? null;
  };

  const cancelOrder = async (orderId: string) => {
    const { error } = await supabase.rpc('ss_cancel_order', { p_order_id: orderId });
    if (error) { console.error('cancelOrder error:', error); toast.error(t('cancelOrderErrToast')); return; }
    toast.success(t('orderCancelledToast'));
  };

  const confirmCodPayment = async (orderId: string) => {
    const { error } = await supabase.rpc('ss_confirm_cod_payment', { p_order_id: orderId });
    if (error) {
      console.error('confirmCodPayment error:', error);
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('payment_already_settled')) toast.error(t('paymentAlreadyConfirmedToast'));
      else if (msg.includes('not_a_cod_order')) toast.error(t('notCodOrderToast'));
      else toast.error(t('confirmPaymentGenericErrToast'));
      return;
    }
    toast.success(t('cashConfirmedToast'));
  };

  const updateOrderStatus = async (orderId: string, status: Order['status']) => {
    const order = orders.find(o => o.id === orderId);
    const patch: Record<string, any> = { status };
    if (order && status === 'completed' && order.paymentMethod === 'online' && order.paymentStatus === 'successful') {
      patch.payment_status = 'released';
      toast.success(t('paymentReleasedToast').replace('{amount}', String(order.totalPrice)));
    }
    const { error } = await supabase.from('ss_orders').update(patch).eq('id', orderId);
    if (error) { console.error('updateOrderStatus error:', error); toast.error(t('updateOrderErrToast')); return; }
    toast.success(t('orderMarkedAsToast').replace('{status}', status));
  };

  const addReview = async (reviewData: Omit<Review, 'id' | 'createdAt'>) => {
    const { error } = await supabase.from('ss_reviews').insert({
      offer_id: reviewData.offerId,
      consumer_id: reviewData.consumerId,
      consumer_name: reviewData.consumerName,
      restaurant_id: reviewData.restaurantId,
      rating: reviewData.rating,
      comment: reviewData.comment,
    });
    if (error) { console.error('addReview error:', error); toast.error(t('reviewSubmitErrToast')); return; }
    toast.success(t('reviewSubmittedToast'));
  };

  const markNotificationAsRead = async (id: string) => {
    const { error } = await supabase.from('ss_notifications').update({ read: true }).eq('id', id);
    if (error) console.error('markNotificationAsRead error:', error);
  };

  const clearAllNotifications = async () => {
    if (!user) return;
    const { error } = await supabase.from('ss_notifications').delete().eq('recipient_id', user.id);
    if (error) { console.error('clearAllNotifications error:', error); return; }
    setNotifications([]);
    toast.success(t('notificationsClearedBangToast'));
  };

  const banUser = async (userId: string) => {
    const { error } = await supabase.from('ss_profiles').update({ banned: true }).eq('id', userId);
    if (error) { console.error('banUser error:', error); toast.error(t('banUserErrToast')); return; }
    toast.success(t('userBannedToast'));
  };

  const unbanUser = async (userId: string) => {
    const { error } = await supabase.from('ss_profiles').update({ banned: false }).eq('id', userId);
    if (error) { console.error('unbanUser error:', error); toast.error(t('unbanUserErrToast')); return; }
    toast.success(t('userUnbannedToast'));
  };

  const deleteUser = async (userId: string) => {
    const { error } = await supabase.from('ss_profiles').delete().eq('id', userId);
    if (error) { console.error('deleteUser error:', error); toast.error(t('deleteUserErrToast')); return; }
    toast.success(t('userDeletedToast'));
  };

  const approvePartner = async (partnerId: string) => {
    const { error } = await supabase.from('ss_profiles').update({ approved: true }).eq('id', partnerId);
    if (error) { console.error('approvePartner error:', error); toast.error(t('approvePartnerErrToast')); return; }
    toast.success(t('partnerApprovedToast'));
  };

  const rejectPartner = async (partnerId: string) => {
    const { error } = await supabase.from('ss_profiles').update({ approved: false }).eq('id', partnerId);
    if (error) { console.error('rejectPartner error:', error); toast.error(t('rejectPartnerErrToast')); return; }
    toast.success(t('partnerRejectedToast'));
  };

  const addSupportTicket = async (subject: string, message: string) => {
    if (!user) return;
    const { error } = await supabase.from('ss_support_tickets').insert({
      user_id: user.id,
      user_email: user.email,
      user_name: user.name,
      user_role: user.role,
      subject,
      message,
    });
    if (error) { console.error('addSupportTicket error:', error); toast.error(t('addTicketErrToast')); return; }
    toast.success(t('ticketSubmittedToast'));
  };

  const resolveSupportTicket = async (ticketId: string, response: string) => {
    const { error } = await supabase
      .from('ss_support_tickets')
      .update({ status: 'resolved', response })
      .eq('id', ticketId);
    if (error) { console.error('resolveSupportTicket error:', error); toast.error(t('resolveTicketErrToast')); return; }
    toast.success(t('ticketResolvedToast'));
  };

  return (
    <AppContext.Provider value={{
      user, setUser, selectedCity, setSelectedCity,
      offers, setOffers, orders, setOrders, reviews, setReviews,
      addReview, favorites, toggleFavorite,
      placeOrder, cancelOrder, confirmCodPayment, updateOrderStatus,
      userLocation, setUserLocation,
      language, setLanguage, t,
      notifications, setNotifications, markNotificationAsRead, clearAllNotifications,
      users, setUsers, banUser, unbanUser, deleteUser, approvePartner, rejectPartner,
      supportTickets, addSupportTicket, resolveSupportTicket,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (context === undefined) throw new Error('useAppContext must be used within AppProvider');
  return context;
}
