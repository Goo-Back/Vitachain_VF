import React, { useState, useEffect, useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { OfferCard } from '../components/OfferCard';
import { Search, Filter, MapPin, Loader2, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { motion } from 'motion/react';
import { useSearchParams } from 'react-router-dom';

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

export function Meals() {
  const { offers, user, selectedCity, userLocation, setUserLocation, language, t, users } = useAppContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const [searchTerm, setSearchTerm] = useState(initialQuery);
  const [categoryFilter, setCategoryFilter] = useState('All');

  // Geolocation Specific States
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [isSecure, setIsSecure] = useState(true);

  useEffect(() => {
    // Check HTTPS on mounting
    const isHttps = window.location.protocol === 'https:' || window.location.hostname === 'localhost';
    setIsSecure(isHttps);
  }, []);

  useEffect(() => {
    if (initialQuery) {
      setSearchTerm(initialQuery);
    }
  }, [initialQuery]);

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    if (e.target.value) {
      setSearchParams({ q: e.target.value });
    } else {
      setSearchParams({});
    }
  };

  const categories = [
    { value: 'All', label: t('categoryAll') },
    { value: 'Baked Goods', label: t('bakedGoods') },
    { value: 'Groceries', label: t('supermarket') },
    { value: 'Produce', label: t('produce') },
    { value: 'Box', label: t('surpriseBox') },
    { value: 'Other', label: t('categoryOther') }
  ];

  const targetCity = user?.city || selectedCity;

  // Execute browser native Geolocation callback cleanly on user engagement (Button Click)
  const handleAutoDetectLocation = () => {
    setIsLoadingLocation(true);
    setLocationError(null);

    if (!navigator.geolocation) {
      setLocationError(
        language === 'ar'
          ? 'المتصفح لا يدعم هذا الترخيص الملاحي.'
          : 'Geolocator API is not supported by your current browser.'
      );
      setIsLoadingLocation(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        setIsLoadingLocation(false);
        setLocationError(null);
      },
      (error) => {
        console.error('GPS error signal received:', error);
        setIsLoadingLocation(false);
        if (error.code === error.PERMISSION_DENIED) {
          setLocationError(t('geolocationPermissionDeclined'));
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          // Provide Casablanca Center as accurate fallback
          setUserLocation({ lat: 33.5731, lng: -7.5898 });
          setLocationError(t('geolocationPositionUnavailable'));
        } else if (error.code === error.TIMEOUT) {
          setLocationError(t('geolocationTimeout'));
        } else {
          setLocationError(error.message);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 0
      }
    );
  };

  const handleClearLocation = () => {
    setUserLocation(null);
    setLocationError(null);
  };

  const filteredOffers = useMemo(() => {
    return offers.filter(offer => {
      // Offers are world-readable, but ss_profiles RLS only exposes approved,
      // non-banned restaurants (plus the viewer's own row / admin). A missing
      // partner therefore means an unapproved/banned restaurant, whose offers
      // must NOT surface in the public catalogue — otherwise they leak to
      // consumers while staying hidden from the partner's own Meals view.
      const partner = users.find(u => u.id === offer.restaurantId);
      if (!partner || partner.banned || !partner.approved) {
        return false;
      }

      if (offer.commerceType !== 'Patisserie' && offer.commerceType !== 'Superette' && offer.commerceType !== 'Buffet à volonté') {
        return false;
      }
      const matchesSearch = offer.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                            offer.restaurantName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesCategory = categoryFilter === 'All' || offer.mealCategory === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [offers, searchTerm, categoryFilter, users]);

  const sortedOffers = useMemo(() => {
    return [...filteredOffers].sort((a, b) => {
      // 1. Same city first
      const aSameCity = a.city === targetCity;
      const bSameCity = b.city === targetCity;
      
      if (aSameCity && !bSameCity) return -1;
      if (!aSameCity && bSameCity) return 1;

      // 2. Sort by distance if available
      if (userLocation) {
        if (a.coordinates && b.coordinates) {
          const distA = calculateDistance(userLocation.lat, userLocation.lng, a.coordinates.lat, a.coordinates.lng);
          const distB = calculateDistance(userLocation.lat, userLocation.lng, b.coordinates.lat, b.coordinates.lng);
          return distA - distB;
        }
        if (a.coordinates && !b.coordinates) return -1;
        if (!a.coordinates && b.coordinates) return 1;
      }

      return 0;
    });
  }, [filteredOffers, targetCity, userLocation]);

  const nearYouOffers = targetCity ? sortedOffers.filter(offer => offer.city === targetCity) : [];
  const otherOffers = targetCity ? sortedOffers.filter(offer => offer.city !== targetCity) : sortedOffers;

  const isRTL = language === 'ar';

  return (
    <div className="min-h-screen bg-gray-50 py-12 text-right" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-4xl font-display font-black text-gray-900 mb-4 leading-normal">
            {isRTL ? 'الوجبات المتاحة وعروض الشركاء' : 'Available Meals & Surplus'}
          </h1>
          <p className="text-sm font-semibold text-gray-500 max-w-2xl mx-auto leading-relaxed">
            {isRTL ? 'اكتشف الوجبات اللذيذة والمنقذة بخصم يصل لـ 70% في الدفعة اليومية من مخبزات ومتاجر الدار البيضاء والمحمدية.' : 'Discover delicious rescued foodstuffs from certified local partners. Save money, lock trust escrow and preserve our planet.'}
          </p>
        </div>

        {/* High-Precision Interactive Geolocation System Module */}
        <div className="bg-white rounded-[2.2rem] border border-gray-100 p-6 shadow-sm mb-10 text-right">
          <div className={`flex flex-col lg:flex-row items-center justify-between gap-6 ${isRTL ? 'lg:flex-row-reverse' : ''}`}>
            
            <div className="space-y-2 flex-grow max-w-2xl text-left">
              <p className="text-xs font-semibold text-gray-500 leading-relaxed flex items-center gap-2">
                <MapPin className="h-5 w-5 text-primary flex-shrink-0" />
                {t('autoDetectExplanation')}
              </p>
            </div>

            <div className="flex-shrink-0 flex flex-wrap gap-2.5 items-center">
              {userLocation ? (
                <button
                  onClick={handleClearLocation}
                  className="bg-red-50 hover:bg-red-100 text-red-650 px-4.5 py-3 rounded-full text-xs font-bold transition-all border border-red-200 cursor-pointer"
                >
                  {t('clearGpsMode')}
                </button>
              ) : (
                <button
                  onClick={handleAutoDetectLocation}
                  disabled={isLoadingLocation}
                  className="bg-primary hover:bg-primary-hover text-white px-6 py-3.5 rounded-full text-xs font-black flex items-center gap-2 shadow-lg shadow-primary/20 hover:shadow-xl transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isLoadingLocation ? (
                    <>
                      <Loader2 className="h-4.5 w-4.5 animate-spin" />
                      <span>{t('gpsAcquiringSignal')}</span>
                    </>
                  ) : (
                    <>
                      <MapPin className="h-4.5 w-4.5" />
                      <span>{t('autoDetectBtn')}</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* HTTPS Unsecure Connection Alert */}
          {!isSecure && (
            <div className="mt-4 p-4 bg-amber-50 rounded-2xl border border-amber-200 flex gap-3 text-amber-900 text-xs items-start text-right">
              <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">{isRTL ? 'بيئة التشغيل قد لا تدعم GPS' : 'Secure Protocol Requirement Warning'}</p>
                <p className="text-amber-700 leading-relaxed font-semibold mt-0.5">{t('geolocationUnsecureWarning')}</p>
              </div>
            </div>
          )}

          {/* Location Loading Panel */}
          {isLoadingLocation && (
            <div className="mt-4 p-4 bg-slate-50 border border-slate-100 rounded-2xl flex items-center justify-center gap-2.5 text-xs text-gray-500 font-bold">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>{isRTL ? 'الرجاء السماح بالوصول لموقعك الجغرافي عند ظهور نافذة المتصفح...' : 'Waiting for browser geolocation access confirmation...'}</span>
            </div>
          )}

          {/* Location Result Alerts (Success/Failure/Fallback options) */}
          {locationError && (
            <div className="mt-4 p-4 bg-rose-50 rounded-2xl border border-rose-150 flex gap-3 text-rose-900 text-xs items-start text-right">
              <AlertTriangle className="h-5 w-5 text-rose-600 flex-shrink-0 mt-0.5" />
              <div className="flex-grow">
                <p className="font-extrabold">{isRTL ? 'إشارة الموقع الجغرافي' : 'Location Services Notification'}</p>
                <p className="text-rose-800 leading-relaxed font-semibold mt-1">{locationError}</p>
                
                {/* Timeout / Failure Retry Option */}
                <button
                  onClick={handleAutoDetectLocation}
                  className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-rose-100 hover:bg-rose-200 text-rose-900 rounded-xl font-bold transition-all text-[11px] cursor-pointer"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>{isRTL ? 'إعادة محاولة الاتصال بالمستشعر' : 'Retry Connecting to GPS Sensor'}</span>
                </button>
              </div>
            </div>
          )}

          {userLocation && !locationError && (
            <div className="mt-4 p-4 bg-emerald-50 rounded-2xl border border-emerald-150 flex gap-3 text-emerald-900 text-xs items-start text-right">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5 animate-bounce" />
              <div>
                <p className="font-extrabold">{isRTL ? 'اكتشاف وتحديث نظام الملاحة' : 'Precise Map Positioning Activated'}</p>
                <p className="text-emerald-850 leading-relaxed font-semibold mt-0.5">{t('geolocationSuccess')}</p>
                <div className="mt-1 font-mono text-[10px] text-emerald-700 font-semibold">
                  Lat: {userLocation.lat.toFixed(5)}, Lng: {userLocation.lng.toFixed(5)} ({targetCity || 'Morocco Local Area'})
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Filters and Search Dashboard */}
        <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-gray-100 mb-10 flex flex-col md:flex-row gap-5">
          <div className="relative flex-1">
            <Search className={`absolute ${isRTL ? 'right-4.5' : 'left-4.5'} top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400`} />
            <input
              type="text"
              placeholder={t('searchPlaceholder')}
              value={searchTerm}
              onChange={handleSearchChange}
              className={`w-full ${isRTL ? 'pr-12' : 'pl-12'} py-3.5 rounded-2xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all text-xs font-semibold`}
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-2 md:pb-0 hide-scrollbar flex-row-reverse">
            <Filter className="h-4.5 w-4.5 text-gray-400 flex-shrink-0 ml-2" />
            {categories.map(cat => (
              <button
                key={cat.value}
                onClick={() => setCategoryFilter(cat.value)}
                className={`whitespace-nowrap px-4 py-2 rounded-full text-xs font-black transition-all border cursor-pointer ${
                  categoryFilter === cat.value
                    ? 'bg-primary text-white border-primary shadow-md shadow-primary/20'
                    : 'bg-gray-50 text-gray-650 border-gray-100 hover:border-gray-250 hover:bg-gray-100'
                }`}
              >
                <span>{cat.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Offers Grid */}
        {sortedOffers.length > 0 ? (
          <div className="space-y-12">
            
            {/* Near You Grid */}
            {nearYouOffers.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-6 flex-row-reverse border-b border-gray-100 pb-3">
                  <MapPin className="h-5.5 w-5.5 text-primary" />
                  <h2 className="text-2xl font-display font-black text-gray-900 text-right">
                    {isRTL ? (
                      <>عروض بالقرب منك في <span className="text-primary">{targetCity === 'Casablanca' ? 'الدار البيضاء' : 'المحمدية'}</span></>
                    ) : (
                      <>Near you in {targetCity || 'your area'}</>
                    )}
                  </h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {nearYouOffers.map((offer, index) => (
                    <motion.div
                      key={offer.id}
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <OfferCard offer={offer} />
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* Other Area Surplus Grid */}
            {otherOffers.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-6 flex-row-reverse border-b border-gray-100 pb-3">
                  <MapPin className={`h-5.5 w-5.5 ${targetCity ? 'text-gray-400' : 'text-primary'}`} />
                  <h2 className="text-2xl font-display font-black text-gray-900 text-right">
                    {targetCity ? (
                      isRTL ? 'عروض مناطق ومدن أخرى متبقية' : 'Other areas'
                    ) : (
                      isRTL ? 'جميع عروض إنقاذ الأكل المتاحة' : 'All Rescue Offers'
                    )}
                  </h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                  {otherOffers.map((offer, index) => (
                    <motion.div
                      key={offer.id}
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <OfferCard offer={offer} />
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-24 bg-white rounded-[2.5rem] border border-gray-100 shadow-sm text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-50 mb-4 mx-auto">
              <Search className="h-8 w-8 text-gray-300" />
            </div>
            <h3 className="text-xl font-display font-black text-gray-900 mb-2">
              {t('noProductsFound')}
            </h3>
            <p className="text-xs font-semibold text-gray-500 max-w-sm mx-auto leading-relaxed">
              {isRTL ? 'لم نعثر على وجبات فائضة تناسب الفلتر المحدد. جرب تغيير فئة الأكل أو مسح الكلمة الرئيسية.' : 'Try adjusting your search terms or choosing a different city category.'}
            </p>
            <button 
              onClick={() => {
                setSearchTerm('');
                setSearchParams({});
                setCategoryFilter('All');
              }}
              className="mt-6 text-xs font-black text-primary hover:underline cursor-pointer bg-primary/10 px-4 py-2 rounded-full"
            >
              {t('resetFilters')}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
