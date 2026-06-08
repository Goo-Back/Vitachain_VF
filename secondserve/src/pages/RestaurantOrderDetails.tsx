import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Navigate, Link } from 'react-router-dom';
import { fetchOrderById } from '../lib/supabase';
import { Order } from '../types';
import { useAppContext, isOrderExpired } from '../context/AppContext';
import { ConfirmModal } from '../components/ConfirmModal';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Loader2,
  AlertTriangle,
  User as UserIcon,
  Phone,
  MessageSquare,
  CreditCard,
  Coins,
  ShoppingBag,
  Clock,
  CheckCircle2,
  XCircle,
  MapPin,
  Hash,
} from 'lucide-react';
import { toast } from 'sonner';

export function RestaurantOrderDetails() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, orders, updateOrderStatus, cancelOrder, language } = useAppContext();
  const isRTL = language === 'ar';

  const [fallbackOrder, setFallbackOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pickupCodeInput, setPickupCodeInput] = useState('');
  const [pickupCodeError, setPickupCodeError] = useState<string | null>(null);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    const local = orders.find(o => o.id === id);
    if (local) {
      setFallbackOrder(null);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const data = await fetchOrderById(id);
        if (!data) {
          setErrorMessage(isRTL ? 'لم يتم العثور على الطلب.' : 'Order not found.');
        } else {
          if (user && (data.restaurantId === user.id || user.role === 'admin')) {
            setFallbackOrder(data);
          } else {
            setErrorMessage(isRTL ? 'غير مسموح لك بعرض هذا الطلب.' : 'You are not authorized to view this order.');
          }
        }
      } catch (e) {
        console.error('Failed to load order:', e);
        setErrorMessage(isRTL ? 'تعذر تحميل الطلب.' : 'Could not load order.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, orders, user, isRTL]);

  if (!user) return <Navigate to="/auth" />;
  if (user.role !== 'restaurant' && user.role !== 'admin') return <Navigate to="/" />;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-gray-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const order: Order | undefined = orders.find(o => o.id === id) || fallbackOrder || undefined;

  if (errorMessage || !order) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center" dir={isRTL ? 'rtl' : 'ltr'}>
        <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-amber-500" />
        <p className="text-gray-700 font-semibold mb-6">{errorMessage}</p>
        <Link
          to="/restaurant-dashboard"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-xl font-semibold hover:bg-primary transition-colors"
        >
          <ArrowLeft className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
          {isRTL ? 'العودة إلى لوحة التحكم' : 'Back to dashboard'}
        </Link>
      </div>
    );
  }

  const expired = isOrderExpired(order);
  const offer = order.offerSnapshot;

  const statusBadge = (() => {
    if (order.status === 'completed') return { label: isRTL ? '✅ مكتمل' : '✅ Completed', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 };
    if (order.status === 'cancelled') return { label: isRTL ? '❌ ملغى' : '❌ Cancelled', cls: 'bg-red-50 text-red-700 border-red-200', Icon: XCircle };
    if (expired) return { label: isRTL ? '⌛ منتهي الصلاحية' : '⌛ Expired', cls: 'bg-amber-50 text-amber-800 border-amber-200', Icon: AlertTriangle };
    return { label: isRTL ? '⏳ قيد الانتظار' : '⏳ Pending', cls: 'bg-blue-50 text-blue-700 border-blue-200', Icon: Clock };
  })();

  const handleConfirmPickup = async () => {
    if (pickupCodeInput.trim() !== (order.pickupCode || '')) {
      setPickupCodeError(isRTL ? '❌ رمز الاستلام غير صحيح' : '❌ Pickup code incorrect');
      return;
    }
    setPickupCodeError(null);
    await updateOrderStatus(order.id, 'completed');
    toast.success(isRTL ? '✅ تم تأكيد الاستلام' : '✅ Pickup confirmed');
  };

  const handleCancel = async () => {
    setConfirmCancelOpen(false);
    await cancelOrder(order.id);
    navigate('/restaurant-dashboard');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-2xl mx-auto px-4">
        <button
          onClick={() => navigate('/restaurant-dashboard')}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
          {isRTL ? 'العودة إلى الطلبات' : 'Back to orders'}
        </button>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-gray-950 text-white px-6 py-5 flex items-center justify-between">
            <div>
              <h1 className="font-display font-black text-xl">
                {isRTL ? 'تفاصيل الحجز' : 'Order details'}
              </h1>
              <p className="text-xs text-gray-400 font-mono mt-1">#{order.id}</p>
            </div>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border ${statusBadge.cls}`}>
              <statusBadge.Icon className="h-3.5 w-3.5" />
              {statusBadge.label}
            </span>
          </div>

          <div className="p-6 space-y-6">
            {/* Customer block */}
            <section>
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-3">
                {isRTL ? 'بيانات الزبون' : 'Customer information'}
              </h2>
              <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-3">
                <div className="flex items-center gap-2.5">
                  <UserIcon className="h-4 w-4 text-slate-400 flex-shrink-0" />
                  <span className="font-bold text-sm text-slate-900">{order.consumerName || (isRTL ? 'زبون مجهول' : 'Unnamed customer')}</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Phone className="h-4 w-4 text-slate-400 flex-shrink-0" />
                  <a
                    href={`tel:${order.consumerPhone}`}
                    className="font-mono font-bold text-sm text-primary hover:underline"
                  >
                    {order.consumerPhone || (isRTL ? 'لا يوجد رقم' : 'No phone')}
                  </a>
                </div>
                {order.customerMessage && (
                  <div className="flex gap-2.5 pt-1 border-t border-slate-100">
                    <MessageSquare className="h-4 w-4 text-slate-400 flex-shrink-0 mt-0.5" />
                    <p className="text-xs italic text-slate-700 font-semibold leading-relaxed">"{order.customerMessage}"</p>
                  </div>
                )}
              </div>
            </section>

            {/* Item block */}
            <section>
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-3">
                {isRTL ? 'العنصر المحجوز' : 'Reserved item'}
              </h2>
              <div className="flex gap-4 items-center bg-gray-50 rounded-2xl p-4">
                <img src={offer.image} alt={offer.name} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                <div className="flex-grow">
                  <p className="font-bold text-gray-900 text-sm">{offer.name}</p>
                  <p className="text-xs text-gray-600 mt-1 flex items-center gap-1.5">
                    <ShoppingBag className="h-3 w-3 text-gray-400" /> × {order.quantity}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono font-black text-primary">{order.totalPrice.toFixed(2)} MAD</p>
                </div>
              </div>
            </section>

            {/* Payment block */}
            <section>
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-3">
                {isRTL ? 'الدفع' : 'Payment'}
              </h2>
              <div className={`p-4 rounded-2xl border ${
                order.paymentMethod === 'online'
                  ? 'bg-indigo-50 border-indigo-100'
                  : 'bg-amber-50 border-amber-100'
              }`}>
                <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider">
                  {order.paymentMethod === 'online' ? (
                    <>
                      <CreditCard className="h-4 w-4 text-indigo-700" />
                      <span className="text-indigo-950">
                        {isRTL ? 'دفع آمن عبر الإنترنت' : 'Secure online payment'}
                      </span>
                    </>
                  ) : (
                    <>
                      <Coins className="h-4 w-4 text-amber-700" />
                      <span className="text-amber-950">
                        {isRTL ? 'الدفع نقداً عند الاستلام' : 'Cash on delivery'}
                      </span>
                    </>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed mt-2 font-semibold text-gray-700">
                  {order.paymentMethod === 'online'
                    ? order.paymentStatus === 'released'
                      ? (isRTL ? '🟢 تم تحرير المبلغ إلى رصيدك.' : '🟢 Funds released to your balance.')
                      : (isRTL
                          ? '⏳ المبلغ محجوز في الضمان. سيتم تحريره بعد تأكيد الاستلام.'
                          : '⏳ Funds held in escrow. Will release after pickup confirmation.')
                    : (isRTL
                        ? '🤝 يجب تحصيل المبلغ نقداً من الزبون عند الاستلام.'
                        : '🤝 Collect the amount in cash from the customer at pickup time.')}
                </p>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/40">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-600">
                    {isRTL ? 'المبلغ' : 'Amount'}
                  </span>
                  <span className="font-mono font-black text-base text-gray-950">{order.totalPrice.toFixed(2)} MAD</span>
                </div>
              </div>
            </section>

            {/* Pickup info */}
            {order.pickupCode && (
              <section>
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-3">
                  {isRTL ? 'الاستلام' : 'Pickup'}
                </h2>
                <div className="bg-primary/5 border border-primary/10 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center gap-2 text-xs text-gray-700 font-semibold">
                    <Clock className="h-3.5 w-3.5 text-primary" />
                    <span>
                      {isRTL ? 'قبل الساعة' : 'Before'}: <span className="font-mono font-black">{offer.timeLimit}</span>
                    </span>
                  </div>
                  {offer.address && (
                    <div className="flex items-start gap-2 text-xs text-gray-700 font-semibold">
                      <MapPin className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" />
                      <span>{offer.address}</span>
                    </div>
                  )}
                </div>
              </section>
            )}

            <p className="text-[11px] text-gray-400 font-mono text-center pt-2">
              {isRTL ? 'تم الحجز في' : 'Reserved at'}: {new Date(order.createdAt).toLocaleString()}
            </p>

            {/* Action: confirm pickup */}
            {order.status === 'active' && !expired && order.pickupCode && (
              <div className="bg-gray-950 text-white rounded-2xl p-5 space-y-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                  {isRTL ? 'أكد الاستلام بإدخال رمز الزبون' : 'Confirm pickup by entering the customer code'}
                </p>
                <div className="relative">
                  <Hash className="absolute top-1/2 -translate-y-1/2 left-3 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    value={pickupCodeInput}
                    onChange={(e) => setPickupCodeInput(e.target.value.replace(/[^\d]/g, ''))}
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/10 border border-white/20 text-sm font-mono font-bold text-white tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-gray-500"
                    placeholder="••••"
                  />
                </div>
                {pickupCodeError && (
                  <p className="text-[11px] font-bold text-red-300">{pickupCodeError}</p>
                )}
                <button
                  onClick={handleConfirmPickup}
                  className="w-full px-4 py-3 rounded-xl text-xs font-bold bg-primary hover:opacity-90 text-white uppercase tracking-wider transition flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {isRTL ? 'تأكيد الاستلام' : 'Confirm pickup'}
                </button>
              </div>
            )}

            {order.status === 'active' && (
              <button
                onClick={() => setConfirmCancelOpen(true)}
                className="w-full px-4 py-3 rounded-xl text-sm font-bold bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
              >
                {isRTL ? 'إلغاء الطلب' : 'Cancel order'}
              </button>
            )}
          </div>
        </motion.div>
      </div>

      <ConfirmModal
        isOpen={confirmCancelOpen}
        title={isRTL ? 'إلغاء الطلب' : 'Cancel order'}
        message={isRTL ? 'هل أنت متأكد من إلغاء هذا الطلب؟' : 'Are you sure you want to cancel this order?'}
        confirmText={isRTL ? 'تأكيد' : 'Confirm'}
        cancelText={isRTL ? 'تراجع' : 'Cancel'}
        onConfirm={handleCancel}
        onCancel={() => setConfirmCancelOpen(false)}
      />
    </div>
  );
}
