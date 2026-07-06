import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, MapPin, Heart, ShoppingBag, Gift, Navigation, CheckCircle2, X, Star, CreditCard, Truck, AlertTriangle, ArrowRight, ArrowLeft, ShieldCheck, Loader2, Eye } from 'lucide-react';
import { Offer } from '../types';
import { useAppContext } from '../context/AppContext';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { buildMapSearchUrl, buildMapEmbedUrl } from '../lib/utils';

// Distance calculation helper
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    0.5 - Math.cos(dLat)/2 + 
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    (1 - Math.cos(dLon))/2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

interface OfferCardProps {
  offer: Offer;
}

export function OfferCard({ offer }: OfferCardProps) {
  const { user, favorites, toggleFavorite, placeOrder, userLocation, reviews, language, t } = useAppContext();
  const isFavorite = favorites.includes(offer.id);
  const [quantity, setQuantity] = useState(1);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isReviewsModalOpen, setIsReviewsModalOpen] = useState(false);
  
  // Checkout Multi-step State Parameters
  const [checkoutStep, setCheckoutStep] = useState<'form' | 'choice' | 'online_payment' | 'processing' | 'success'>('form');
  const [placedOrderId, setPlacedOrderId] = useState<string | null>(null);
  const [reservationName, setReservationName] = useState(user?.name || '');
  const [reservationPhone, setReservationPhone] = useState(user?.phone || '');
  const [customerMessage, setCustomerMessage] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'delivery'>('delivery');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCVV, setCardCVV] = useState('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [simulateCardDecline, setSimulateCardDecline] = useState(false);

  const distance = userLocation && offer.coordinates 
    ? calculateDistance(userLocation.lat, userLocation.lng, offer.coordinates.lat, offer.coordinates.lng).toFixed(1)
    : null;

  const mapUrl = offer.coordinates
    ? buildMapSearchUrl(offer.coordinates, language)
    : buildMapSearchUrl(offer.address || offer.restaurantName + ' ' + offer.city, language);

  const handleReserveClick = () => {
    setReservationName(user?.name || '');
    setReservationPhone(user?.phone || '');
    setCustomerMessage('');
    setCardNumber('');
    setCardExpiry('');
    setCardCVV('');
    setPaymentError(null);
    setCheckoutStep('form');
    setIsModalOpen(true);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reservationName.trim() || !reservationPhone.trim()) {
      toast.error(t('errNameAndPhoneRequired'));
      return;
    }
    // Advance to choices
    setCheckoutStep('choice');
  };

  const handlePayOnDelivery = async () => {
    setPaymentMethod('delivery');
    const orderId = await placeOrder(offer, quantity, {
      consumerName: reservationName,
      consumerPhone: reservationPhone,
      customerMessage: customerMessage,
      paymentMethod: 'delivery',
      paymentStatus: 'pending'
    });
    if (orderId) {
      setPlacedOrderId(orderId);
      setCheckoutStep('success');
      setQuantity(1);
      toast.success(t('cashOrderPlacedToast'));
    }
  };

  const handleStartPayOnline = () => {
    setPaymentMethod('online');
    setCheckoutStep('online_payment');
  };

  const handleOnlinePaymentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPaymentError(null);

    // Form validations
    if (cardNumber.replace(/\s/g, '').length < 16) {
      setPaymentError(t('errInvalidCardNumber'));
      return;
    }
    if (!/^\d{2}\/\d{2}$/.test(cardExpiry)) {
      setPaymentError(t('errInvalidExpiry'));
      return;
    }
    if (cardCVV.length < 3) {
      setPaymentError(t('errInvalidCvv'));
      return;
    }

    setCheckoutStep('processing');

    setTimeout(async () => {
      if (simulateCardDecline) {
        setCheckoutStep('online_payment');
        setPaymentError(t('transactionDeclinedError'));
        toast.error(t('paymentDeclinedToast'));
        return;
      }

      // Successful payment checkout integration
      const orderId = await placeOrder(offer, quantity, {
        consumerName: reservationName,
        consumerPhone: reservationPhone,
        customerMessage: customerMessage,
        paymentMethod: 'online',
        paymentStatus: 'successful'
      });

      if (orderId) {
        setPlacedOrderId(orderId);
        setCheckoutStep('success');
        setQuantity(1);
        toast.success(t('paymentSuccessEscrowToast'));
      }
    }, 2200);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
  };

  const offerReviews = reviews.filter(r => r.offerId === offer.id);
  const averageRating = offerReviews.length > 0 
    ? (offerReviews.reduce((sum, r) => sum + r.rating, 0) / offerReviews.length).toFixed(1)
    : null;

  const isRTL = language === 'ar';

  return (
    <>
      <motion.div 
        whileHover={{ y: -5 }}
        className="bg-white rounded-3xl overflow-hidden shadow-sm hover:shadow-xl transition-all border border-gray-100 flex flex-col h-full text-right"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <div className="relative h-48 overflow-hidden group">
          <img 
            src={offer.image} 
            alt={offer.name} 
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
            referrerPolicy="no-referrer"
          />
          <div className={`absolute top-4 ${isRTL ? 'right-4' : 'left-4'} bg-white/95 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs font-bold shadow-sm flex items-center gap-1.5 ${offer.isSurpriseBox ? 'text-primary' : 'text-gray-900'}`}>
            {offer.isSurpriseBox && <Gift className="h-3.5 w-3.5" />}
            <span>
              {offer.isSurpriseBox 
                ? t('surpriseBox') 
                : offer.commerceType === 'Patisserie' 
                  ? t('patisserie') 
                  : offer.commerceType === 'Superette' 
                    ? t('superette') 
                    : offer.commerceType === 'Buffet à volonté' 
                      ? t('buffet') 
                      : t('supermarket')}
            </span>
          </div>
          <button 
            type="button"
            onClick={() => toggleFavorite(offer.id)}
            className={`absolute top-4 ${isRTL ? 'left-4' : 'right-4'} p-2 bg-white/90 backdrop-blur-sm rounded-full text-gray-400 hover:text-red-500 transition-colors shadow-sm cursor-pointer`}
          >
            <Heart className={`h-5 w-5 ${isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
          </button>
          <div className={`absolute bottom-4 ${isRTL ? 'right-4' : 'left-4'} bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs font-medium text-white flex items-center gap-1.5`}>
            <Clock className="h-3.5 w-3.5" />
            <span>{isRTL ? `قبل ${offer.timeLimit}` : `Before ${offer.timeLimit}`}</span>
          </div>
        </div>

        <div className="p-6 flex flex-col flex-grow">
          <div className="flex justify-between items-start mb-2 gap-4">
            <div className="flex-grow">
              <h3 className="font-display font-black text-xl text-gray-900 mb-1 leading-snug">{offer.name}</h3>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <p className="text-sm text-gray-500 font-medium font-semibold">
                  {offer.restaurantName}
                </p>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-gray-100 text-gray-600 text-xs font-bold">
                  <MapPin className="h-3 w-3 text-primary" />
                  <span>{offer.city === 'Casablanca' ? t('casablanca') : offer.city === 'Mohammedia' ? t('mohammedia') : offer.city}</span>
                </span>
                {averageRating && (
                  <button 
                    type="button"
                    onClick={() => setIsReviewsModalOpen(true)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-yellow-50 text-yellow-700 text-xs font-black hover:bg-yellow-100 transition-colors cursor-pointer"
                  >
                    <Star className="h-3 w-3 fill-current" />
                    <span>{averageRating} ({offerReviews.length})</span>
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-500 flex items-start gap-1">
                <MapPin className="h-3.5 w-3.5 mt-0.5 flex-shrink-0 text-primary" />
                <span className="line-clamp-2">{offer.address || `${offer.restaurantName}, ${offer.city}`}</span>
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="font-display font-black text-xl text-primary font-mono">{offer.reducedPrice} MAD</div>
              <div className="text-sm text-gray-400 line-through font-mono">{offer.originalPrice} MAD</div>
            </div>
          </div>

          {/* Map Button & Distance */}
          <div className="mt-2 mb-4 flex items-center justify-between gap-4">
            <a 
              href={mapUrl} 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-primary bg-primary/10 hover:bg-primary/20 px-3.5 py-1.5 rounded-full transition-colors shadow-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <Navigation className="h-3.5 w-3.5" />
              <span>{t('getDirections')}</span>
            </a>
            {distance && (
              <span className="text-xs font-bold text-secondary bg-secondary/10 px-2.5 py-1 rounded-md">
                {distance} {t('distanceKm')}
              </span>
            )}
          </div>

          <p className="text-gray-600 text-xs font-medium mb-6 line-clamp-2 flex-grow text-right leading-relaxed">
            {offer.description}
          </p>

          <div className="flex items-center justify-between pt-4 border-t border-gray-100 mt-auto">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-black uppercase px-2.5 py-1 rounded-lg ${
                offer.quantity > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              }`}>
                {offer.quantity > 0 ? `${t('quantityLeft')}: ${offer.quantity}` : (isRTL ? 'بيعت بالكامل' : 'Sold Out')}
              </span>
            </div>
            
            {offer.quantity > 0 && (
              <div className="flex items-center gap-3">
                <select 
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="bg-gray-50 border border-gray-200 text-gray-900 text-xs font-bold rounded-xl focus:ring-primary focus:border-primary block p-2 outline-none cursor-pointer font-mono"
                >
                  {[...Array(offer.quantity)].map((_, i) => (
                    <option key={i + 1} value={i + 1}>{i + 1}</option>
                  ))}
                </select>
                <div className="flex flex-col items-end gap-1.5">
                  <button
                    type="button"
                    onClick={handleReserveClick}
                    className="flex items-center gap-2 bg-gray-950 hover:bg-primary text-white px-4 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-sm"
                  >
                    <ShoppingBag className="h-4 w-4" />
                    <span>{isRTL ? 'احجز الآن' : 'Reserve'}</span>
                  </button>
                  <Link
                    to={`/checkout/${offer.id}`}
                    className="text-[10px] font-bold text-gray-500 hover:text-primary uppercase tracking-wider transition-colors"
                  >
                    {isRTL ? 'الدفع في صفحة كاملة ↗' : 'Open full checkout ↗'}
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* Complete Partner Marketplace Checkout System */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/65 backdrop-blur-md" dir={isRTL ? 'rtl' : 'ltr'}>
          <motion.div 
            initial={{ opacity: 0, scale: 0.93, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-lg overflow-hidden relative border border-gray-100 flex flex-col max-h-[90vh] text-right"
          >
            {/* Header Close */}
            <button 
              type="button"
              onClick={handleCloseModal}
              className={`absolute top-5 ${isRTL ? 'left-5' : 'right-5'} text-gray-400 hover:text-gray-600 transition-all p-1.5 rounded-full hover:bg-gray-100 z-10 cursor-pointer`}
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="overflow-y-auto p-8 hide-scrollbar">
              {/* Step 1: Customer Contact Form & Message */}
              {checkoutStep === 'form' && (
                <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}>
                  <div className="mb-6">
                    <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 bg-primary/10 rounded-full text-primary">
                      {t('checkoutStepOf')}
                    </span>
                    <h2 className="text-2xl font-display font-black text-gray-950 mt-2">{t('checkoutDetails')}</h2>
                    <p className="text-xs text-gray-500 mt-1 font-semibold leading-relaxed">
                      {isRTL ? (
                        <span>أنت تطلب {quantity}x <span className="font-extrabold text-gray-900">{offer.name}</span> من {offer.restaurantName}.</span>
                      ) : (
                        <span>You are ordering {quantity}x <span className="font-semibold text-gray-800">{offer.name}</span> from {offer.restaurantName}.</span>
                      )}
                    </p>
                  </div>

                  <form onSubmit={handleFormSubmit} className="space-y-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">{t('fullNameLabel')}</label>
                      <input 
                        type="text" 
                        required
                        value={reservationName}
                        onChange={(e) => setReservationName(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 text-gray-900 font-medium text-sm transition-all text-right"
                        placeholder={t('fullNamePlaceholder')}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">{t('phoneLabel')}</label>
                      <input 
                        type="tel" 
                        required
                        value={reservationPhone}
                        onChange={(e) => setReservationPhone(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 text-gray-900 font-medium text-sm transition-all text-right font-mono"
                        placeholder={t('phonePlaceholder')}
                      />
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-1.5">
                        <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider">{t('optionalMsgLabel')}</label>
                      </div>
                      <textarea 
                        value={customerMessage}
                        onChange={(e) => setCustomerMessage(e.target.value)}
                        rows={2}
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 text-gray-900 font-medium text-sm transition-all resize-none text-right"
                        placeholder={t('optionalMsgPlaceholder')}
                      />
                    </div>

                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-start gap-3">
                      <Clock className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-bold text-slate-900">{t('realtimeSyncNote')}</p>
                        <p className="text-[10.5px] text-slate-500 leading-relaxed mt-0.5 font-medium">
                          {t('realtimeSyncDesc')}
                        </p>
                      </div>
                    </div>

                    <button 
                      type="submit"
                      className="w-full mt-6 bg-gray-950 hover:bg-primary text-white py-4 rounded-xl font-bold transition-all flex justify-center items-center gap-2 text-xs uppercase tracking-wider shadow-md cursor-pointer"
                    >
                      <span>{t('continueBtn')}</span>
                      <ArrowRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
                    </button>
                  </form>
                </motion.div>
              )}

              {/* Step 2: Payment Selector Choices */}
              {checkoutStep === 'choice' && (
                <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 0.98 }}>
                  <div className="mb-6">
                    <span className="text-[10px] font-bold text-primary uppercase tracking-wider px-2.5 py-1 bg-primary/10 rounded-full">
                      {isRTL ? 'الخطوة 2 من 2' : 'Step 2 of 2'}
                    </span>
                    <button 
                      type="button"
                      onClick={() => setCheckoutStep('form')}
                      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-all font-semibold mt-3 cursor-pointer"
                    >
                      <ArrowLeft className={`h-3.5 w-3.5 ${isRTL ? 'rotate-180' : ''}`} />
                      <span>{t('backToDetails')}</span>
                    </button>
                    <h2 className="text-2xl font-display font-black text-gray-950 mt-3">{t('settlementMethod')}</h2>
                    <p className="text-xs text-gray-500 mt-1 font-semibold leading-relaxed">
                      {t('selectSettlementDesc')} <span className="font-extrabold text-gray-950 font-mono">{(Number(offer.reducedPrice) * quantity).toFixed(2)} MAD</span>.
                    </p>
                  </div>

                  <div className="space-y-4">
                    {/* Cash / Pay on delivery Option Card */}
                    <button
                      type="button"
                      onClick={handlePayOnDelivery}
                      className="w-full p-5 rounded-2xl border-2 border-slate-200 hover:border-gray-900 text-right transition-all relative flex gap-4 cursor-pointer focus:ring-2 focus:ring-gray-900/15 focus:outline-none"
                    >
                      <div className="w-12 h-12 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center flex-shrink-0">
                        <Truck className="h-6 w-6" />
                      </div>
                      <div className="text-right">
                        <span className="font-bold text-gray-900 text-sm block">{t('payDeliveryTitle')}</span>
                        <p className="text-xs text-slate-600 mt-2 leading-relaxed font-semibold">
                          {t('payDeliveryDesc')}
                        </p>
                      </div>
                    </button>
                  </div>
                </motion.div>
              )}

              {/* Step 3: Interactive Online Card Typing Form */}
              {checkoutStep === 'online_payment' && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <div className="mb-6">
                    <span className="text-[10px] font-bold text-primary uppercase tracking-wider px-2.5 py-1 bg-primary/10 rounded-full">
                      {isRTL ? 'الخطوة 3 من 3' : 'Step 3 of 3'}
                    </span>
                    <button 
                      type="button"
                      onClick={() => setCheckoutStep('choice')}
                      className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-all font-semibold mt-3 cursor-pointer"
                    >
                      <ArrowLeft className={`h-3.5 w-3.5 ${isRTL ? 'rotate-180' : ''}`} />
                      <span>{isRTL ? 'البدائل والدفع' : 'Back to choices'}</span>
                    </button>
                    <h2 className="text-2xl font-display font-black text-gray-950 mt-3">{t('cardInfo')}</h2>
                    <p className="text-xs text-gray-500 mt-1 font-semibold leading-relaxed">
                      {t('cardInfoDesc')} <span className="font-extrabold text-gray-950 font-mono">{(Number(offer.reducedPrice) * quantity).toFixed(2)} MAD</span>.
                    </p>
                  </div>

                  {paymentError && (
                    <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs flex gap-2.5 items-start mb-4 text-right">
                      <AlertTriangle className="h-4.5 w-4.5 text-rose-600 flex-shrink-0 mt-0.5 animate-bounce" />
                      <div className="space-y-1">
                        <p className="font-bold">{isRTL ? 'خطأ في عملية التحقق' : 'Authorization Failure'}</p>
                        <p className="text-rose-700">{paymentError}</p>
                      </div>
                    </div>
                  )}

                  <form onSubmit={handleOnlinePaymentSubmit} className="space-y-4">
                    {/* Visually stunning credit card mock canvas */}
                    <div className="w-full h-44 bg-gradient-to-tr from-slate-900 via-indigo-950 to-slate-950 text-white rounded-3xl p-6 relative overflow-hidden shadow-xl border border-slate-800 flex flex-col justify-between" dir="ltr">
                      <div className="flex justify-between items-start">
                        <div className="space-y-1 text-left">
                          <span className="text-[9px] uppercase tracking-widest font-bold text-slate-400">{t('bankName')}</span>
                          <div className="text-base font-black tracking-wide">SecondServe Guarantee</div>
                        </div>
                        <div className="px-2.5 py-1 bg-white/10 rounded-lg text-[9px] font-mono border border-white/20">
                          {simulateCardDecline ? t('declineStatus') : t('approvedStatus')}
                        </div>
                      </div>

                      <div className="space-y-2 text-left">
                        <div className="text-lg font-mono tracking-widest text-slate-100 select-all">
                          {cardNumber ? cardNumber.replace(/(\d{4})/g, '$1 ').trim() : '•••• •••• •••• ••••'}
                        </div>
                        <div className="flex justify-between items-end text-[10px] font-mono">
                          <div>
                            <span className="block text-slate-400 text-[8px] uppercase font-semibold">Cardholder</span>
                            <span className="text-xs font-bold text-white uppercase">{reservationName || 'John Doe'}</span>
                          </div>
                          <div className="flex gap-4">
                            <div>
                              <span className="block text-slate-400 text-[8px] uppercase font-semibold">Expires</span>
                              <span className="text-xs font-bold text-white uppercase">{cardExpiry || 'MM/YY'}</span>
                            </div>
                            <div>
                              <span className="block text-slate-400 text-[8px] uppercase font-semibold">CVV</span>
                              <span className="text-xs font-bold text-white uppercase">{cardCVV || '•••'}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Card input details */}
                    <div className="space-y-3 pt-2">
                      <div>
                        <label className="block text-xs font-bold text-gray-700 uppercase mb-1">{t('cardNumberLabel')}</label>
                        <input 
                          type="text"
                          required
                          maxLength={16}
                          value={cardNumber}
                          onChange={(e) => setCardNumber(e.target.value.replace(/\D/g, ''))}
                          className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 text-sm font-mono tracking-widest text-right"
                          placeholder="4242424242424242"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">{t('cardExpiryLabel')}</label>
                          <input 
                            type="text"
                            required
                            maxLength={5}
                            value={cardExpiry}
                            onChange={(e) => {
                              let val = e.target.value.replace(/[^\d/]/g, '');
                              if (val.length === 2 && !val.includes('/')) val += '/';
                              setCardExpiry(val);
                            }}
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 text-sm font-mono text-center text-gray-900"
                            placeholder="12/28"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-bold text-gray-700 uppercase mb-1">{t('cardCvvLabel')}</label>
                          <input 
                            type="password"
                            required
                            maxLength={4}
                            value={cardCVV}
                            onChange={(e) => setCardCVV(e.target.value.replace(/\D/g, ''))}
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 text-sm font-mono text-center text-gray-900"
                            placeholder="123"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Decline Simulation Trigger (Allows testing errors!) */}
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between">
                      <input 
                        type="checkbox"
                        id="sim-dec"
                        checked={simulateCardDecline}
                        onChange={(e) => setSimulateCardDecline(e.target.checked)}
                        className="w-4 h-4 text-primary bg-gray-100 border-gray-300 rounded focus:ring-primary cursor-pointer"
                      />
                      <label htmlFor="sim-dec" className="text-right cursor-pointer mr-2 pr-1">
                        <p className="text-xs font-bold text-gray-900">{t('simulateDeclineLabel')}</p>
                        <p className="text-[10px] text-gray-500">{t('simulateDeclineDesc')}</p>
                      </label>
                    </div>

                    <button 
                      type="submit"
                      className="w-full mt-4 bg-primary hover:bg-primary-hover text-white py-3.5 rounded-xl font-bold transition-all flex justify-center items-center gap-2 text-xs uppercase cursor-pointer tracking-wider shadow-sm"
                    >
                      <ShieldCheck className="h-4.5 w-4.5" />
                      <span>{t('authorizePaymentBtn')}</span>
                    </button>
                  </form>
                </motion.div>
              )}

              {/* Processing payment step overlay */}
              {checkoutStep === 'processing' && (
                <motion.div 
                  initial={{ opacity: 0 }} 
                  animate={{ opacity: 1 }}
                  className="py-12 flex flex-col items-center justify-center text-center space-y-4"
                >
                  <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center border border-primary/20 relative mx-auto">
                    <Loader2 className="h-8 w-8 text-primary animate-spin" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-gray-950 font-display">{t('processingMsgTitle')}</h3>
                    <p className="text-xs text-gray-500 max-w-xs mt-2 leading-relaxed font-semibold mx-auto">
                      {t('processingMsgDesc')}
                    </p>
                  </div>
                </motion.div>
              )}

              {/* Step 4: Success, Real-time Dashboard alert, and Geo-directions display */}
              {checkoutStep === 'success' && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.96 }} 
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center py-4"
                >
                  <div className="w-16 h-16 bg-emerald-100 border border-emerald-200 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-5 shadow-inner">
                    <CheckCircle2 className="h-10 w-10" />
                  </div>
                  <h2 className="text-2xl font-display font-black text-gray-950">
                    {t('orderPlacedSuccess')}
                  </h2>
                  <p className="text-xs text-gray-500 mt-2 max-w-sm mx-auto leading-relaxed font-semibold">
                    {t('orderPlacedDesc')} <span className="font-extrabold text-gray-950">{offer.restaurantName}</span>.
                  </p>

                  {/* Secure Payment Escrow Hold Statement */}
                  {paymentMethod === 'online' ? (
                    <div className="mt-5 p-4 bg-indigo-50 border border-indigo-100 rounded-2xl text-right">
                      <div className="flex items-center gap-2 text-indigo-950 font-black text-xs">
                        <ShieldCheck className="h-4.5 w-4.5 text-indigo-700 flex-shrink-0" />
                        <span>{t('escrowHoldTitle')}</span>
                      </div>
                      <p className="text-[11px] text-indigo-700 leading-relaxed mt-2 font-medium">
                        {t('escrowHoldDesc')}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-5 p-4 bg-amber-50 border border-amber-100 rounded-2xl text-right">
                      <div className="flex items-center gap-2 text-amber-950 font-black text-xs">
                        <Truck className="h-4.5 w-4.5 text-amber-700 flex-shrink-0" />
                        <span>{t('deliveryPaymentTitle')}</span>
                      </div>
                      <p className="text-[11px] text-amber-700 leading-relaxed mt-2 font-semibold">
                        {t('deliveryPaymentDesc')}
                      </p>
                    </div>
                  )}

                  {/* Display distance / coordinates navigation widget */}
                  <div className="mt-5 p-4 bg-slate-50 rounded-2xl border border-slate-100 text-right space-y-2.5">
                    <div className="flex items-center justify-between flex-row-reverse">
                      <div className="text-right">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">{t('pickupLocationTitle')}</p>
                        <p className="text-xs font-black text-slate-800 leading-snug">{offer.address || offer.restaurantName}</p>
                      </div>
                      {distance ? (
                        <span className="text-[10px] font-bold text-white bg-primary px-2.5 py-1 rounded-md flex-shrink-0">
                          📍 {distance} {t('distanceKm')}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-mono flex-shrink-0">GPS Verified</span>
                      )}
                    </div>

                    {offer.coordinates ? (
                      <div className="w-full h-36 rounded-xl overflow-hidden border border-slate-200">
                        <iframe
                          width="100%"
                          height="100%"
                          frameBorder="0"
                          loading="lazy"
                          allowFullScreen
                          referrerPolicy="no-referrer"
                          src={buildMapEmbedUrl(offer.coordinates.lat, offer.coordinates.lng, language)}
                        ></iframe>
                      </div>
                    ) : null}
                  </div>

                  {placedOrderId && (
                    <Link
                      to={`/orders/${placedOrderId}`}
                      onClick={handleCloseModal}
                      className="mt-6 w-full bg-primary text-white hover:bg-primary/90 py-3.5 rounded-xl text-xs font-bold transition-all flex justify-center items-center gap-2 shadow-sm cursor-pointer"
                    >
                      <Eye className="h-4 w-4" />
                      <span>{t('viewReceiptBtn')}</span>
                    </Link>
                  )}
                  <div className="flex flex-col sm:flex-row gap-3 mt-3">
                    <button
                      onClick={handleCloseModal}
                      className="flex-1 bg-gray-900 hover:bg-primary text-white py-3.5 rounded-xl text-xs font-bold transition-all cursor-pointer shadow-sm"
                    >
                      {t('returnMarketplace')}
                    </button>
                    <a
                      href={mapUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 bg-gray-100 hover:bg-gray-250 text-gray-900 py-3.5 rounded-xl text-xs font-bold transition-all flex justify-center items-center gap-1.5"
                    >
                      <Navigation className="h-4 w-4 text-primary" />
                      <span>{t('openGpsDirections')}</span>
                    </a>
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        </div>
      )}

      {/* Reviews Modal */}
      {isReviewsModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" dir={isRTL ? 'rtl' : 'ltr'}>
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-3xl p-8 max-w-lg w-full shadow-2xl relative max-h-[80vh] flex flex-col text-right"
          >
            <button 
              onClick={() => setIsReviewsModalOpen(false)}
              className={`absolute top-4 ${isRTL ? 'left-4' : 'right-4'} p-2 text-gray-400 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-colors cursor-pointer`}
            >
              <X className="h-5 w-5" />
            </button>
            
            <div className="flex items-center gap-4 mb-6 flex-row-reverse">
              <div className="w-16 h-16 bg-yellow-50 rounded-full flex items-center justify-center">
                <Star className="h-8 w-8 text-yellow-500 fill-current" />
              </div>
              <div className="text-right">
                <h2 className="text-2xl font-display font-black text-gray-900">
                  {isRTL ? 'التقييمات والآراء' : 'Reviews'}
                </h2>
                <p className="text-sm font-semibold text-gray-500 mt-1">
                  {isRTL ? `${averageRating} من أصل 5 (${offerReviews.length} تقييم)` : `${averageRating} out of 5 (${offerReviews.length} reviews)`}
                </p>
              </div>
            </div>

            <div className="overflow-y-auto pr-2 space-y-4 flex-grow hide-scrollbar text-right">
              {offerReviews.map(review => (
                <div key={review.id} className="bg-gray-50 p-4 rounded-2xl border border-gray-100">
                  <div className="flex justify-between items-start mb-2 flex-row-reverse">
                    <span className="font-bold text-sm text-gray-900">{review.consumerName}</span>
                    <div className="flex items-center text-yellow-500">
                      <Star className="h-4 w-4 fill-current" />
                      <span className="text-xs font-bold ml-1 text-gray-700">{review.rating}</span>
                    </div>
                  </div>
                  {review.comment && (
                    <p className="text-gray-600 text-xs font-medium leading-relaxed">{review.comment}</p>
                  )}
                  <div className="text-[10px] text-gray-400 mt-2 font-mono">
                    {new Date(review.createdAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      )}
    </>
  );
}
