import React, { useEffect, useState } from 'react';
import { useParams, Navigate, useNavigate, Link } from 'react-router-dom';
import { fetchOrderById } from '../lib/supabase';
import { Order } from '../types';
import { useAppContext, isOrderExpired } from '../context/AppContext';
import { ConfirmModal } from '../components/ConfirmModal';
import { buildMapEmbedUrl, buildMapSearchUrl } from '../lib/utils';
import { Clock, MapPin, ArrowLeft, Loader2, CheckCircle2, XCircle, AlertTriangle, Navigation, ShoppingBag, CreditCard, Coins, Banknote } from 'lucide-react';
import { motion } from 'motion/react';

export function OrderReceipt() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, orders, cancelOrder, confirmCodPayment, t, language } = useAppContext();
  const isRTL = language === 'ar';

  const [fallbackOrder, setFallbackOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorKey, setErrorKey] = useState<'receiptNotFound' | 'receiptNotAuthorized' | null>(null);
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [confirmCodOpen, setConfirmCodOpen] = useState(false);
  const [codConfirming, setCodConfirming] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

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
          setErrorKey('receiptNotFound');
        } else {
          if (user && (data.consumerId === user.id || data.restaurantId === user.id || user.role === 'admin')) {
            setFallbackOrder(data);
          } else {
            setErrorKey('receiptNotAuthorized');
          }
        }
      } catch (e) {
        console.error('Failed to load order receipt:', e);
        setErrorKey('receiptNotFound');
      } finally {
        setLoading(false);
      }
    })();
  }, [id, orders, user]);

  if (!user) return <Navigate to="/auth" />;

  const order: Order | undefined = orders.find(o => o.id === id) || fallbackOrder || undefined;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-gray-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (errorKey || !order) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center" dir={isRTL ? 'rtl' : 'ltr'}>
        <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-amber-500" />
        <p className="text-gray-700 font-semibold mb-6">{t(errorKey || 'receiptNotFound')}</p>
        <Link to="/dashboard" className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-xl font-semibold hover:bg-primary transition-colors">
          <ArrowLeft className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
          {t('receiptBackToDashboard')}
        </Link>
      </div>
    );
  }

  if (user.id !== order.consumerId && user.id !== order.restaurantId && user.role !== 'admin') {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center" dir={isRTL ? 'rtl' : 'ltr'}>
        <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-amber-500" />
        <p className="text-gray-700 font-semibold mb-6">{t('receiptNotAuthorized')}</p>
        <Link to="/dashboard" className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-xl font-semibold hover:bg-primary transition-colors">
          <ArrowLeft className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
          {t('receiptBackToDashboard')}
        </Link>
      </div>
    );
  }

  const expired = isOrderExpired(order);
  const offer = order.offerSnapshot;
  const mapUrl = offer.coordinates
    ? buildMapSearchUrl(offer.coordinates, language)
    : buildMapSearchUrl(offer.address || offer.restaurantName + ' ' + offer.city, language);

  const statusBadge = (() => {
    if (order.status === 'completed') return { label: t('receiptStatusBadgeCompleted'), cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: CheckCircle2 };
    if (order.status === 'cancelled') return { label: t('receiptStatusBadgeCancelled'), cls: 'bg-red-50 text-red-700 border-red-200', Icon: XCircle };
    if (expired) return { label: t('orderExpiredBadge'), cls: 'bg-amber-50 text-amber-800 border-amber-200', Icon: AlertTriangle };
    return { label: t('receiptStatusBadgeActive'), cls: 'bg-blue-50 text-blue-700 border-blue-200', Icon: Clock };
  })();

  const countdownText = (() => {
    if (order.status !== 'active' || !order.expiresAt) return null;
    const diff = new Date(order.expiresAt).getTime() - now;
    if (diff <= 0) return t('countdownExpired');
    const hours = Math.floor(diff / 3_600_000);
    const minutes = Math.floor((diff % 3_600_000) / 60_000);
    return `${t('countdownExpiresIn')} ${hours}h ${minutes}m`;
  })();

  const handleCancel = async () => {
    setConfirmCancelOpen(false);
    await cancelOrder(order.id);
    navigate('/dashboard');
  };

  const handleConfirmCod = async () => {
    setConfirmCodOpen(false);
    setCodConfirming(true);
    await confirmCodPayment(order.id);
    setCodConfirming(false);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-2xl mx-auto px-4">
        <button
          onClick={() => navigate('/dashboard')}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
          {t('receiptBackToDashboard')}
        </button>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-gray-950 text-white px-6 py-5 flex items-center justify-between">
            <div>
              <h1 className="font-display font-black text-xl">{t('receiptPageTitle')}</h1>
              <p className="text-xs text-gray-400 font-mono mt-1">{t('receiptOrderRef')}: {order.id}</p>
            </div>
            <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border ${statusBadge.cls}`}>
              <statusBadge.Icon className="h-3.5 w-3.5" />
              {statusBadge.label}
            </span>
          </div>

          {order.status === 'active' && order.pickupCode && (
            <div className="px-6 py-7 bg-gradient-to-br from-primary/5 to-primary/10 border-b border-primary/10 text-center">
              <p className="text-[11px] font-bold uppercase tracking-widest text-primary mb-2">{t('receiptPickupCodeLabel')}</p>
              <p className="font-mono text-5xl font-black text-gray-950 tracking-[0.4em] select-all">{order.pickupCode}</p>
              <p className="text-xs text-gray-600 mt-3 font-semibold max-w-md mx-auto leading-relaxed">{t('receiptShowCodeNote')}</p>
              {countdownText && (
                <p className="text-[11px] mt-3 font-bold text-amber-700 flex items-center justify-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" /> {countdownText}
                </p>
              )}
            </div>
          )}

          {expired && order.status === 'active' && (
            <div className="px-6 py-4 bg-amber-50 border-b border-amber-100 flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-amber-900 font-semibold leading-relaxed">{t('receiptExpired')}</p>
            </div>
          )}

          <div className="p-6 space-y-6">
            <section>
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-3">{t('receiptItemsSection')}</h2>
              <div className="flex gap-4 items-center bg-gray-50 rounded-2xl p-4">
                <img src={offer.image} alt={offer.name} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" referrerPolicy="no-referrer" />
                <div className="flex-grow">
                  <p className="font-bold text-gray-900 text-sm">{offer.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{offer.restaurantName}</p>
                  <p className="text-xs text-gray-600 mt-1 flex items-center gap-1.5"><ShoppingBag className="h-3 w-3 text-gray-400" /> × {order.quantity}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-mono font-black text-primary">{order.totalPrice.toFixed(2)} MAD</p>
                </div>
              </div>
            </section>

            <section className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-center justify-between">
              <span className="text-xs font-bold text-amber-900">{t('receiptTotalLabel')}</span>
              <span className="font-mono font-black text-lg text-gray-950">{order.totalPrice.toFixed(2)} MAD</span>
            </section>

            <section>
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-3">
                {isRTL ? 'طريقة الدفع' : 'Payment method'}
              </h2>
              <div className={`p-4 rounded-2xl border ${
                order.paymentMethod === 'online'
                  ? 'bg-indigo-50 border-indigo-100 text-indigo-950'
                  : 'bg-amber-50 border-amber-100 text-amber-950'
              }`}>
                <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider">
                  {order.paymentMethod === 'online' ? (
                    <>
                      <CreditCard className="h-4 w-4 text-indigo-700" />
                      <span>{isRTL ? 'دفع آمن عبر الإنترنت' : 'Secure online payment'}</span>
                    </>
                  ) : (
                    <>
                      <Coins className="h-4 w-4 text-amber-700" />
                      <span>{isRTL ? 'الدفع نقداً عند الاستلام' : 'Cash on delivery'}</span>
                    </>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed mt-2 font-semibold text-gray-600">
                  {order.paymentMethod === 'online'
                    ? order.paymentStatus === 'released'
                      ? (isRTL ? '🟢 تم تحرير الأموال إلى الشريك.' : '🟢 Funds released to the partner.')
                      : (isRTL ? '⏳ الأموال محجوزة في الضمان حتى الاستلام.' : '⏳ Funds held in escrow until pickup.')
                    : order.paymentStatus === 'successful'
                      ? (isRTL ? '✅ تم تأكيد الدفع نقداً.' : '✅ Cash payment confirmed.')
                      : (isRTL
                          ? '🤝 أحضر المبلغ نقداً عند الاستلام في الوقت المحدد.'
                          : '🤝 Bring the cash amount at pickup time.')}
                </p>
                {order.paymentStatus === 'successful' && order.paidAt && (
                  <p className="text-[11px] text-gray-400 font-mono mt-1">
                    {isRTL ? 'تم الدفع في' : 'Paid at'}: {new Date(order.paidAt).toLocaleString()}
                  </p>
                )}
              </div>
            </section>

            {user.id === order.consumerId
              && order.paymentMethod === 'delivery'
              && order.paymentStatus === 'pending'
              && order.status !== 'cancelled' && (
              <section className="bg-amber-50 border border-amber-200 rounded-2xl p-4 space-y-3">
                <div className="flex items-start gap-2.5">
                  <Banknote className="h-4 w-4 text-amber-700 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-amber-900">
                      {isRTL ? 'تأكيد الدفع نقداً' : 'Confirm cash payment'}
                    </p>
                    <p className="text-[11px] text-amber-800 mt-1 font-semibold leading-relaxed">
                      {isRTL
                        ? 'بعد تسليم المبلغ نقداً للشريك، اضغط أدناه لتأكيد الدفع.'
                        : 'After handing the cash to the partner, tap below to confirm payment.'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setConfirmCodOpen(true)}
                  disabled={codConfirming}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-bold bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white transition-colors"
                >
                  {codConfirming
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Banknote className="h-4 w-4" />}
                  {isRTL
                    ? `تأكيد دفع ${order.totalPrice.toFixed(2)} MAD نقداً`
                    : `Confirm ${order.totalPrice.toFixed(2)} MAD cash payment`}
                </button>
              </section>
            )}

            <section>
              <h2 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-3">{t('receiptPartnerSection')}</h2>
              <div className="space-y-3 bg-gray-50 rounded-2xl p-4">
                <p className="font-bold text-gray-900 text-sm">{offer.restaurantName}</p>
                {offer.address && (
                  <p className="text-xs text-gray-700 flex items-start gap-2 leading-relaxed">
                    <MapPin className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" />
                    <span>{offer.address}</span>
                  </p>
                )}
                <p className="text-xs text-gray-700 flex items-center gap-2">
                  <Clock className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                  <span>{t('receiptPickupBy')}: <span className="font-bold font-mono">{offer.timeLimit}</span></span>
                </p>
                {offer.coordinates && (
                  <div className="rounded-xl overflow-hidden border border-gray-200 mt-2">
                    <iframe
                      width="100%"
                      height="180"
                      frameBorder="0"
                      loading="lazy"
                      allowFullScreen
                      referrerPolicy="no-referrer"
                      src={buildMapEmbedUrl(offer.coordinates.lat, offer.coordinates.lng, language)}
                    />
                  </div>
                )}
                <div className="flex gap-2 pt-1">
                  <a
                    href={mapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 inline-flex justify-center items-center gap-1.5 px-3 py-2 bg-primary/10 hover:bg-primary/20 text-primary rounded-xl text-xs font-bold transition-colors"
                  >
                    <Navigation className="h-3.5 w-3.5" />
                    {t('receiptViewMap')}
                  </a>
                </div>
              </div>
            </section>

            <p className="text-[11px] text-gray-400 font-mono text-center pt-2">
              {t('receiptPlacedAt')}: {new Date(order.createdAt).toLocaleString()}
            </p>

            {order.status === 'active' && user.id === order.consumerId && (
              <button
                onClick={() => setConfirmCancelOpen(true)}
                className="w-full px-4 py-3 rounded-xl text-sm font-bold bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
              >
                {t('receiptCancelBtn')}
              </button>
            )}
          </div>
        </motion.div>
      </div>

      <ConfirmModal
        isOpen={confirmCancelOpen}
        title={t('receiptCancelBtn')}
        message={t('cancelOrderConfirmMsg')}
        confirmText={t('confirm')}
        cancelText={t('cancel')}
        onConfirm={handleCancel}
        onCancel={() => setConfirmCancelOpen(false)}
      />

      <ConfirmModal
        isOpen={confirmCodOpen}
        title={isRTL ? 'تأكيد الدفع نقداً' : 'Confirm cash payment'}
        message={isRTL
          ? `هل دفعت ${order?.totalPrice.toFixed(2)} MAD نقداً للشريك؟ لا يمكن التراجع عن هذا الإجراء.`
          : `Did you hand ${order?.totalPrice.toFixed(2)} MAD in cash to the partner? This cannot be undone.`}
        confirmText={isRTL ? 'نعم، تم الدفع' : 'Yes, paid'}
        cancelText={t('cancel')}
        onConfirm={handleConfirmCod}
        onCancel={() => setConfirmCodOpen(false)}
      />
    </div>
  );
}
