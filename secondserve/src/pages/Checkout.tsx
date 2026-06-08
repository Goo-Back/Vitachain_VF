import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Navigate, Link } from 'react-router-dom';
import { fetchOfferById } from '../lib/supabase';
import { Offer } from '../types';
import { useAppContext } from '../context/AppContext';
import { toast } from 'sonner';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Loader2,
  User as UserIcon,
  Phone,
  MessageSquare,
  Coins,
  CreditCard,
  ShieldCheck,
  Truck,
  AlertTriangle,
} from 'lucide-react';

type Step = 'form' | 'choice' | 'online_payment' | 'processing';

export function Checkout() {
  const { offerId } = useParams<{ offerId: string }>();
  const navigate = useNavigate();
  const { user, offers, placeOrder, language } = useAppContext();
  const isRTL = language === 'ar';

  const [offer, setOffer] = useState<Offer | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [step, setStep] = useState<Step>('form');
  const [quantity, setQuantity] = useState(1);
  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [message, setMessage] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCVV, setCardCVV] = useState('');
  const [paymentError, setPaymentError] = useState<string | null>(null);

  useEffect(() => {
    if (!offerId) return;
    const local = offers.find(o => o.id === offerId);
    if (local) {
      setOffer(local);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const fetched = await fetchOfferById(offerId);
        if (!fetched) {
          setNotFound(true);
        } else {
          setOffer(fetched);
        }
      } catch (e) {
        console.error('Failed to load offer:', e);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [offerId, offers]);

  if (!user) return <Navigate to="/auth" />;
  if (user.role === 'restaurant' || user.role === 'admin') return <Navigate to="/" />;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-gray-500">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (notFound || !offer) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16 text-center" dir={isRTL ? 'rtl' : 'ltr'}>
        <AlertTriangle className="h-12 w-12 mx-auto mb-4 text-amber-500" />
        <p className="text-gray-700 font-semibold mb-6">
          {isRTL ? 'لم يتم العثور على هذا العرض.' : 'This offer was not found.'}
        </p>
        <Link
          to="/meals"
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white rounded-xl font-semibold hover:bg-primary transition-colors"
        >
          <ArrowLeft className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
          {isRTL ? 'العودة إلى العروض' : 'Back to offers'}
        </Link>
      </div>
    );
  }

  const totalPrice = Number(offer.reducedPrice) * quantity;

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !phone.trim()) {
      toast.error(isRTL ? '❌ المرجو إدخال الاسم ورقم الهاتف' : '❌ Please enter your name and phone');
      return;
    }
    setStep('choice');
  };

  const finalizeOrder = async (paymentMethod: 'online' | 'delivery', paymentStatus: 'pending' | 'successful') => {
    const orderId = await placeOrder(offer, quantity, {
      consumerName: name,
      consumerPhone: phone,
      customerMessage: message,
      paymentMethod,
      paymentStatus,
    });
    if (orderId) {
      navigate(`/orders/${orderId}`);
    }
  };

  const handlePayOnDelivery = async () => {
    await finalizeOrder('delivery', 'pending');
  };

  const handlePayOnline = (e: React.FormEvent) => {
    e.preventDefault();
    setPaymentError(null);
    if (cardNumber.replace(/\s/g, '').length < 16) {
      setPaymentError(isRTL ? 'رقم بطاقة غير صالح' : 'Invalid card number (16 digits required)');
      return;
    }
    if (!/^\d{2}\/\d{2}$/.test(cardExpiry)) {
      setPaymentError(isRTL ? 'صيغة التاريخ غير صحيحة MM/YY' : 'Invalid expiry format (MM/YY)');
      return;
    }
    if (cardCVV.length < 3) {
      setPaymentError(isRTL ? 'رمز الحماية غير صالح' : 'Invalid security code');
      return;
    }
    setStep('processing');
    setTimeout(async () => {
      await finalizeOrder('online', 'successful');
    }, 1800);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-2xl mx-auto px-4">
        <button
          onClick={() => (step === 'form' ? navigate(-1) : setStep('form'))}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-900 mb-4"
        >
          <ArrowLeft className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
          {isRTL ? 'رجوع' : 'Back'}
        </button>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-gray-950 text-white px-6 py-5">
            <h1 className="font-display font-black text-xl">
              {isRTL ? 'إتمام الحجز' : 'Checkout'}
            </h1>
            <p className="text-xs text-gray-400 mt-1 font-semibold">
              {offer.name} — {offer.restaurantName}
            </p>
          </div>

          <div className="p-6 space-y-6">
            <div className="flex gap-4 items-center bg-gray-50 rounded-2xl p-4">
              <img src={offer.image} alt={offer.name} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" referrerPolicy="no-referrer" />
              <div className="flex-grow">
                <p className="font-bold text-gray-900 text-sm">{offer.name}</p>
                <p className="text-xs text-gray-500">{offer.restaurantName}</p>
              </div>
              <div className="text-right">
                <p className="font-mono font-black text-primary">{Number(offer.reducedPrice).toFixed(2)} MAD</p>
              </div>
            </div>

            <div className="flex items-center justify-between bg-slate-50 rounded-2xl p-4">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                {isRTL ? 'الكمية' : 'Quantity'}
              </span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="w-8 h-8 rounded-lg bg-white border border-gray-200 font-bold hover:bg-gray-100"
                  disabled={step !== 'form'}
                >−</button>
                <span className="font-mono font-black text-lg w-6 text-center">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity(Math.min(offer.quantity, quantity + 1))}
                  className="w-8 h-8 rounded-lg bg-white border border-gray-200 font-bold hover:bg-gray-100"
                  disabled={step !== 'form'}
                >+</button>
              </div>
            </div>

            <div className="flex items-center justify-between bg-amber-50 border border-amber-100 rounded-2xl p-4">
              <span className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                {isRTL ? 'المبلغ الإجمالي' : 'Total'}
              </span>
              <span className="font-mono font-black text-lg text-gray-950">{totalPrice.toFixed(2)} MAD</span>
            </div>

            {step === 'form' && (
              <form onSubmit={handleFormSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wider">
                    {isRTL ? 'الاسم الكامل' : 'Full name'}
                  </label>
                  <div className="relative">
                    <UserIcon className="absolute top-1/2 -translate-y-1/2 left-3 h-4 w-4 text-gray-400" />
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder={isRTL ? 'أدخل اسمك' : 'Your name'}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wider">
                    {isRTL ? 'رقم الهاتف' : 'Phone number'}
                  </label>
                  <div className="relative">
                    <Phone className="absolute top-1/2 -translate-y-1/2 left-3 h-4 w-4 text-gray-400" />
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      required
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="06XXXXXXXX"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wider">
                    {isRTL ? 'رسالة للشريك (اختياري)' : 'Message for partner (optional)'}
                  </label>
                  <div className="relative">
                    <MessageSquare className="absolute top-3 left-3 h-4 w-4 text-gray-400" />
                    <textarea
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      rows={3}
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                      placeholder={isRTL ? 'أي تعليمات خاصة...' : 'Any special instructions...'}
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="w-full px-4 py-3.5 rounded-xl text-sm font-bold bg-gray-950 hover:bg-primary text-white uppercase tracking-wider transition-colors"
                >
                  {isRTL ? 'متابعة إلى الدفع' : 'Continue to payment'}
                </button>
              </form>
            )}

            {step === 'choice' && (
              <div className="space-y-4">
                <button
                  onClick={handlePayOnDelivery}
                  type="button"
                  className="w-full flex items-start gap-4 p-4 rounded-2xl border-2 border-amber-200 bg-amber-50 hover:border-amber-400 transition-all text-left"
                >
                  <Coins className="h-6 w-6 text-amber-700 flex-shrink-0 mt-0.5" />
                  <div className="flex-grow">
                    <p className="font-bold text-sm text-amber-950">
                      {isRTL ? 'الدفع نقداً عند الاستلام' : 'Cash on delivery'}
                    </p>
                    <p className="text-[11px] text-amber-800 mt-1 font-semibold leading-relaxed">
                      {isRTL
                        ? 'احجز الآن وادفع نقداً للشريك مباشرة عند الاستلام.'
                        : 'Reserve now and pay the partner directly in cash at pickup.'}
                    </p>
                  </div>
                  <Truck className="h-5 w-5 text-amber-700 flex-shrink-0 mt-0.5" />
                </button>

                <button
                  onClick={() => setStep('online_payment')}
                  type="button"
                  className="w-full flex items-start gap-4 p-4 rounded-2xl border-2 border-indigo-200 bg-indigo-50 hover:border-indigo-400 transition-all text-left"
                >
                  <CreditCard className="h-6 w-6 text-indigo-700 flex-shrink-0 mt-0.5" />
                  <div className="flex-grow">
                    <p className="font-bold text-sm text-indigo-950">
                      {isRTL ? 'الدفع الآمن عبر الإنترنت' : 'Secure online payment'}
                    </p>
                    <p className="text-[11px] text-indigo-800 mt-1 font-semibold leading-relaxed">
                      {isRTL
                        ? 'ادفع الآن ويتم الاحتفاظ بالمبلغ في الضمان حتى الاستلام.'
                        : 'Pay now — funds held in escrow until pickup is confirmed.'}
                    </p>
                  </div>
                  <ShieldCheck className="h-5 w-5 text-indigo-700 flex-shrink-0 mt-0.5" />
                </button>
              </div>
            )}

            {step === 'online_payment' && (
              <form onSubmit={handlePayOnline} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wider">
                    {isRTL ? 'رقم البطاقة' : 'Card number'}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={19}
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value.replace(/[^\d]/g, '').replace(/(\d{4})(?=\d)/g, '$1 '))}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="1234 5678 9012 3456"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wider">MM/YY</label>
                    <input
                      type="text"
                      maxLength={5}
                      value={cardExpiry}
                      onChange={(e) => {
                        let v = e.target.value.replace(/[^\d]/g, '');
                        if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2, 4);
                        setCardExpiry(v);
                      }}
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="12/29"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wider">CVV</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={4}
                      value={cardCVV}
                      onChange={(e) => setCardCVV(e.target.value.replace(/[^\d]/g, ''))}
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm font-mono font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
                      placeholder="123"
                    />
                  </div>
                </div>
                {paymentError && (
                  <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-xs text-red-700 font-semibold">
                    {paymentError}
                  </div>
                )}
                <button
                  type="submit"
                  className="w-full px-4 py-3.5 rounded-xl text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white uppercase tracking-wider transition-colors flex items-center justify-center gap-2"
                >
                  <ShieldCheck className="h-4 w-4" />
                  {isRTL ? `ادفع ${totalPrice.toFixed(2)} MAD` : `Pay ${totalPrice.toFixed(2)} MAD`}
                </button>
              </form>
            )}

            {step === 'processing' && (
              <div className="text-center py-8">
                <Loader2 className="h-10 w-10 animate-spin mx-auto mb-4 text-indigo-600" />
                <p className="font-bold text-sm text-gray-900">
                  {isRTL ? 'جاري معالجة الدفع...' : 'Processing payment...'}
                </p>
                <p className="text-xs text-gray-500 mt-2 font-semibold">
                  {isRTL ? 'لا تغلق هذه الصفحة' : 'Please do not close this page'}
                </p>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
