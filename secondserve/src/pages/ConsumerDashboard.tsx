import React, { useState } from 'react';
import { useAppContext, isOrderExpired } from '../context/AppContext';
import { ShoppingBag, Heart, Settings, Clock, CheckCircle2, XCircle, MapPin, User as UserIcon, Mail, Phone, Star, MessageSquare, ExternalLink, Loader2, Crosshair, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { Navigate, Link } from 'react-router-dom';
import { OfferCard } from '../components/OfferCard';
import { motion, AnimatePresence } from 'motion/react';

import { toast } from 'sonner';
import { City } from '../types';
import { ConfirmModal } from '../components/ConfirmModal';
import { LocationPermissionModal } from '../components/LocationPermissionModal';
import { buildMapSearchUrl, buildMapEmbedUrl } from '../lib/utils';

export function ConsumerDashboard() {
  const { user, setUser, setSelectedCity, orders, offers, favorites, cancelOrder, addReview, reviews, supportTickets, addSupportTicket, language, t } = useAppContext();
  const [activeTab, setActiveTab] = useState<'orders' | 'favorites' | 'settings' | 'support'>('orders');
  
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [selectedOrderForReview, setSelectedOrderForReview] = useState<any>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [pendingProfileData, setPendingProfileData] = useState<FormData | null>(null);

  // Support inputs
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');

  // Controlled states for Personal Info & Location
  const [profileName, setProfileName] = useState(user?.name || '');
  const [profileEmail, setProfileEmail] = useState(user?.email || '');
  const [profileCity, setProfileCity] = useState<City>(user?.city || 'Casablanca');
  const [profilePhone, setProfilePhone] = useState(user?.phone || '');
  const [profileAddress, setProfileAddress] = useState(user?.address || '');
  const [profileLat, setProfileLat] = useState(user?.coordinates?.lat !== undefined ? String(user.coordinates.lat) : '33.5731');
  const [profileLng, setProfileLng] = useState(user?.coordinates?.lng !== undefined ? String(user.coordinates.lng) : '-7.5898');

  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [isPermissionModalOpen, setIsPermissionModalOpen] = useState(false);
  const [locationError, setLocationError] = useState<{
    code: number;
    message: string;
    details: string;
  } | null>(null);

  // Dragging pin visual map state
  const [isDraggingPin, setIsDraggingPin] = useState(false);
  const [pinOffset, setPinOffset] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  if (!user || user.role !== 'consumer') {
    return <Navigate to="/auth" />;
  }

  const handleOpenPermissionModal = () => {
    if (!navigator.geolocation) {
      toast.error('❌ Geolocation is not supported by your browser');
      return;
    }
    setIsPermissionModalOpen(true);
  };

  const handleGrantPermission = () => {
    setIsPermissionModalOpen(false);
    executeNativeGeolocation();
  };

  const executeNativeGeolocation = () => {
    setIsDetectingLocation(true);
    setLocationError(null);
    const loadingToastId = toast.loading('⏳ Accessing your GPS location...');

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        const currentLatStr = String(latitude.toFixed(6));
        const currentLngStr = String(longitude.toFixed(6));
        setProfileLat(currentLatStr);
        setProfileLng(currentLngStr);

        let newAddress = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
        let detectedCity: City = profileCity;

        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&accept-language=${language}`
          );
          if (response.ok) {
            const data = await response.json();
            newAddress = data.display_name || newAddress;
            
            // Match city
            const components = data.address;
            if (components) {
              const place = components.city || components.town || components.suburb || components.state || '';
              if (place.toLowerCase().includes('mohammedia')) {
                detectedCity = 'Mohammedia';
              } else {
                detectedCity = 'Casablanca';
              }
            }
          }
        } catch (error) {
          console.error("Reverse geocoding failed", error);
        }

        setProfileAddress(newAddress);
        setProfileCity(detectedCity);
        setPinOffset({ x: 0, y: 0 }); // reset center pin offset

        setIsDetectingLocation(false);
        toast.dismiss(loadingToastId);
        toast.success('📍 Precise GPS location resolved successfully!');
      },
      (error) => {
        setIsDetectingLocation(false);
        toast.dismiss(loadingToastId);

        let errorTitle = "Location Error";
        let userMessage = "Unable to retrieve your location.";
        let troubleshooting = "Please verify your device browser settings and try again.";

        if (error.code === error.PERMISSION_DENIED) {
          errorTitle = "Permission Blocked";
          userMessage = "Location permission denied. Please allow location access.";
          troubleshooting = "Look for a lock icon 🔒 next to your browser’s URL input field and switch 'Location' to 'Allow'. Once updated, click Retry below to scan coordinates.";
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          errorTitle = "Position Unavailable";
          userMessage = "Unable to acquire a robust GPS lock.";
          troubleshooting = "Your physical position could not be detected. Please ensure you are outdoors or connected to a secure Wi-Fi node, or enter coordinates manually.";
        } else if (error.code === error.TIMEOUT) {
          errorTitle = "Request Timeout";
          userMessage = "Location request took too long and timed out.";
          troubleshooting = "The connection timed out after 10 seconds. Try moving closer to windows, or tap Retry below to scan search coordinates again.";
        }

        setLocationError({
          code: error.code,
          message: userMessage,
          details: troubleshooting
        });

        toast.error(`❌ ${userMessage}`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const handleSaveSettings = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsProfileModalOpen(true);
  };

  const confirmSaveSettings = () => {
    const latVal = parseFloat(profileLat);
    const lngVal = parseFloat(profileLng);
    
    const updatedUser = {
      ...user,
      name: profileName,
      email: profileEmail,
      city: profileCity,
      phone: profilePhone,
      address: profileAddress,
      coordinates: !isNaN(latVal) && !isNaN(lngVal) ? { lat: latVal, lng: lngVal } : undefined
    };

    setUser(updatedUser);
    setSelectedCity(profileCity);
    setIsProfileModalOpen(false);
    toast.success('✅ Personal profile and GPS coordinates saved successfully!');
  };

  const handleMapPadMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDraggingPin(true);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setDragStart({ x, y });
  };

  const handleMapPadMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingPin) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const deltaX = x - dragStart.x;
    const deltaY = y - dragStart.y;

    const currentLat = parseFloat(profileLat) || 33.5731;
    const currentLng = parseFloat(profileLng) || -7.5898;

    const newLat = (currentLat - deltaY * 0.00005).toFixed(6);
    const newLng = (currentLng + deltaX * 0.00005).toFixed(6);

    setProfileLat(newLat);
    setProfileLng(newLng);
    setDragStart({ x, y });
  };

  const handleMapPadMouseUp = () => {
    setIsDraggingPin(false);
  };

  const handleMapPadTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    setIsDraggingPin(true);
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    setDragStart({ x, y });
  };

  const handleMapPadTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isDraggingPin) return;
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;

    const deltaX = x - dragStart.x;
    const deltaY = y - dragStart.y;

    const currentLat = parseFloat(profileLat) || 33.5731;
    const currentLng = parseFloat(profileLng) || -7.5898;

    const newLat = (currentLat - deltaY * 0.00005).toFixed(6);
    const newLng = (currentLng + deltaX * 0.00005).toFixed(6);

    setProfileLat(newLat);
    setProfileLng(newLng);
    setDragStart({ x, y });
  };

  const userOrders = orders.filter(o => o.consumerId === user.id);
  const favoriteOffers = offers.filter(o => favorites.includes(o.id));

  const handleReviewSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedOrderForReview) return;
    
    addReview({
      offerId: selectedOrderForReview.offerId,
      consumerId: user.id,
      consumerName: user.name,
      restaurantId: selectedOrderForReview.restaurantId,
      rating,
      comment
    });
    
    setReviewModalOpen(false);
    setSelectedOrderForReview(null);
    setRating(5);
    setComment('');
  };

  const hasReviewed = (offerId: string) => {
    return reviews.some(r => r.offerId === offerId && r.consumerId === user.id);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Header */}
        <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 mb-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center text-primary font-display font-bold text-3xl">
              {user.name.charAt(0)}
            </div>
            <div>
              <h1 className="text-3xl font-display font-bold text-gray-900 mb-1">
                Hello, {user.name}
              </h1>
              <p className="text-gray-500 flex items-center gap-2">
                <MapPin className="h-4 w-4" /> {user.city}
              </p>
            </div>
          </div>
          <div className="bg-secondary/10 px-6 py-4 rounded-2xl flex items-center gap-4">
            <div className="bg-secondary p-2 rounded-xl text-white">
              <ShoppingBag className="h-6 w-6" />
            </div>
            <div>
              <div className="text-2xl font-display font-bold text-gray-900">{userOrders.filter(o => o.status === 'completed').length}</div>
              <div className="text-sm font-medium text-secondary">meals saved</div>
            </div>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar */}
          <div className="lg:w-64 flex-shrink-0">
            <div className="bg-white rounded-3xl p-4 shadow-sm border border-gray-100 flex flex-col gap-2 sticky top-28">
              <button
                onClick={() => setActiveTab('orders')}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors ${
                  activeTab === 'orders' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <ShoppingBag className="h-5 w-5" />
                {language === 'ar' ? 'طلباتي النشطة' : 'My Orders'}
              </button>
              <button
                onClick={() => setActiveTab('favorites')}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors ${
                  activeTab === 'favorites' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Heart className="h-5 w-5" />
                {language === 'ar' ? 'المفضلة' : 'Favorites'}
              </button>
              <button
                onClick={() => setActiveTab('support')}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors ${
                  activeTab === 'support' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <MessageSquare className="h-5 w-5" />
                {language === 'ar' ? 'الدعم والمساعدة' : 'Help & Support'}
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-colors ${
                  activeTab === 'settings' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Settings className="h-5 w-5" />
                {language === 'ar' ? 'حسابي وبياناتي' : 'Settings'}
              </button>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-grow">
            {activeTab === 'orders' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
                <h2 className="text-2xl font-display font-bold text-gray-900 mb-6">Order History</h2>
                
                {userOrders.length === 0 ? (
                  <div className="text-center py-12 text-gray-500">
                    <ShoppingBag className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p>You haven't placed any orders yet.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {userOrders.map(order => (
                      <div key={order.id} className="border border-gray-100 rounded-2xl p-6 flex flex-col md:flex-row gap-6 items-center hover:shadow-md transition-shadow">
                        <img 
                          src={order.offerSnapshot.image} 
                          alt={order.offerSnapshot.name} 
                          className="w-24 h-24 rounded-xl object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <div className="flex-grow text-center md:text-left">
                          <div className="flex flex-col md:flex-row md:justify-between md:items-start mb-2">
                            <div>
                              <h3 className="font-bold text-lg text-gray-900">{order.offerSnapshot.name}</h3>
                              <p className="text-gray-500 text-sm">{order.offerSnapshot.restaurantName}</p>
                            </div>
                            <div className="mt-2 md:mt-0">
                              {(() => {
                                const expired = isOrderExpired(order);
                                const cls = expired ? 'bg-amber-50 text-amber-800' :
                                  order.status === 'active' ? 'bg-blue-50 text-blue-700' :
                                  order.status === 'completed' ? 'bg-green-50 text-green-700' :
                                  'bg-red-50 text-red-700';
                                const Icon = expired ? Clock :
                                  order.status === 'active' ? Clock :
                                  order.status === 'completed' ? CheckCircle2 : XCircle;
                                const label = expired ? t('orderExpiredBadge') :
                                  order.status === 'active' ? t('receiptStatusBadgeActive') :
                                  order.status === 'completed' ? t('receiptStatusBadgeCompleted') :
                                  t('receiptStatusBadgeCancelled');
                                return (
                                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${cls}`}>
                                    <Icon className="h-3.5 w-3.5" />
                                    {label}
                                  </span>
                                );
                              })()}
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-4 text-sm text-gray-600 mt-4 justify-center md:justify-start">
                            <div className="flex items-center gap-1.5"><ShoppingBag className="h-4 w-4 text-gray-400" /> <span className="font-medium">Quantity:</span> {order.quantity}</div>
                            <div className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-gray-400" /> <span className="font-medium">Total:</span> {order.totalPrice} MAD</div>
                            <div className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-gray-400" /> <span className="font-medium">Date:</span> {new Date(order.createdAt).toLocaleDateString()}</div>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2 flex-shrink-0">
                          {order.status === 'active' && (
                            <>
                              <Link
                                to={`/orders/${order.id}`}
                                className="bg-primary text-white hover:bg-primary/90 px-4 py-2 rounded-xl text-sm font-bold transition-colors w-full flex items-center justify-center gap-2"
                              >
                                <Eye className="h-4 w-4" />
                                {t('viewReceiptBtn')}
                              </Link>
                              <button
                                onClick={() => cancelOrder(order.id)}
                                className="text-red-600 hover:bg-red-50 px-4 py-2 rounded-xl text-sm font-medium transition-colors w-full"
                              >
                                {t('cancelOrderBtn')}
                              </button>
                            </>
                          )}
                          {order.status === 'completed' && !hasReviewed(order.offerId) && (
                            <button 
                              onClick={() => {
                                setSelectedOrderForReview(order);
                                setReviewModalOpen(true);
                              }}
                              className="bg-primary/10 text-primary hover:bg-primary/20 px-4 py-2 rounded-xl text-sm font-medium transition-colors w-full flex items-center justify-center gap-2"
                            >
                              <Star className="h-4 w-4" />
                              Leave Review
                            </button>
                          )}
                          <a 
                            href={order.offerSnapshot.coordinates
                              ? buildMapSearchUrl(order.offerSnapshot.coordinates, language)
                              : buildMapSearchUrl(order.offerSnapshot.address || order.offerSnapshot.restaurantName + ' ' + order.offerSnapshot.city, language)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-gray-100 text-gray-700 hover:bg-gray-200 px-4 py-2 rounded-xl text-sm font-medium transition-colors w-full flex items-center justify-center gap-2"
                          >
                            <ExternalLink className="h-4 w-4" />
                            View Location
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'favorites' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <h2 className="text-2xl font-display font-bold text-gray-900 mb-6 px-2">Your Favorites</h2>
                {favoriteOffers.length === 0 ? (
                  <div className="bg-white rounded-3xl p-12 text-center text-gray-500 border border-gray-100 shadow-sm">
                    <Heart className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                    <p>You don't have any favorites yet.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {favoriteOffers.map(offer => (
                      <OfferCard key={offer.id} offer={offer} />
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
                <h2 className="text-2xl font-display font-semibold text-gray-900 mb-6">Personal Information</h2>
                <form className="space-y-6 max-w-2xl" onSubmit={handleSaveSettings}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">{t('labelFullName')}</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <UserIcon className="h-5 w-5 text-gray-400" />
                        </div>
                        <input required name="name" type="text" value={profileName} onChange={(e) => setProfileName(e.target.value)} className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 focus:bg-white text-gray-950 font-medium transition-all" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">{t('labelEmail')}</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <Mail className="h-5 w-5 text-gray-400" />
                        </div>
                        <input required name="email" type="email" value={profileEmail} onChange={(e) => setProfileEmail(e.target.value)} className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 focus:bg-white text-gray-950 font-medium transition-all" />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">{t('labelCity')}</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <MapPin className="h-5 w-5 text-gray-400" />
                        </div>
                        <select required name="city" value={profileCity} onChange={(e) => setProfileCity(e.target.value as City)} className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 focus:bg-white text-gray-950 font-medium transition-all">
                          <option value="Casablanca">{t('casablanca')}</option>
                          <option value="Mohammedia">{t('mohammedia')}</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">{t('labelPhoneNumber')}</label>
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <Phone className="h-5 w-5 text-gray-400" />
                        </div>
                        <input required name="phone" type="tel" value={profilePhone} onChange={(e) => setProfilePhone(e.target.value)} className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 focus:bg-white text-gray-950 font-medium transition-all" placeholder="06 00 00 00 00" />
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">{t('labelStreetAddress')}</label>
                      <button 
                        type="button"
                        onClick={handleOpenPermissionModal}
                        disabled={isDetectingLocation}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-primary/10 text-primary hover:bg-primary/25 rounded-xl transition-all disabled:opacity-50 cursor-pointer"
                      >
                        {isDetectingLocation ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
                        {isDetectingLocation ? 'Detecting...' : 'Detect My Location'}
                      </button>
                    </div>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <MapPin className="h-5 w-5 text-gray-400" />
                      </div>
                      <input required name="address" type="text" value={profileAddress} onChange={(e) => setProfileAddress(e.target.value)} className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 focus:bg-white text-gray-950 font-medium transition-all" placeholder="123 Street Name..." />
                    </div>

                    {locationError && (
                      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-rose-800 space-y-2 mt-4">
                        <div className="flex items-center gap-2 font-bold text-sm">
                          <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse flex-shrink-0"></span>
                          <span>{locationError.message}</span>
                        </div>
                        <p className="text-xs text-rose-700 leading-relaxed font-semibold">
                          {locationError.details}
                        </p>
                        <div className="pt-2 flex gap-3">
                          <button
                            type="button"
                            onClick={executeNativeGeolocation}
                            className="px-3 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-900 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1.5"
                          >
                            🔄 Retry GPS Detection
                          </button>
                          <button
                            type="button"
                            onClick={() => setLocationError(null)}
                            className="px-3 py-1.5 bg-rose-100 hover:bg-rose-200 text-rose-900 text-xs font-semibold rounded-xl transition-all cursor-pointer"
                          >
                            Dismiss Warning
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">{t('labelLatitude')}</label>
                      <input name="lat" type="number" step="any" value={profileLat} onChange={(e) => setProfileLat(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 text-gray-950 font-medium font-mono" placeholder="33.5731" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">{t('labelLongitude')}</label>
                      <input name="lng" type="number" step="any" value={profileLng} onChange={(e) => setProfileLng(e.target.value)} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 text-gray-950 font-medium font-mono" placeholder="-7.5898" />
                    </div>
                  </div>

                  {/* Google Maps Interactive Integration */}
                  <div className="pt-6 border-t border-gray-100">
                    <label className="block text-base font-semibold text-gray-900 mb-1">{t('labelInteractiveLocation')}</label>
                    <p className="text-xs text-gray-500 mb-4">
                      Drag anywhere on the visual grid adjuster pad or click fine-tune arrows to adjust your coordinates. Updates are saved on save profile.
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
                      {/* Virtual Tactile Pin Dragger Box */}
                      <div className="space-y-4">
                        <div 
                          className="w-full h-48 bg-slate-100 rounded-2xl relative border border-gray-200 overflow-hidden select-none cursor-crosshair flex flex-col justify-center items-center"
                          style={{ backgroundImage: 'radial-gradient(#e2e8f0 1.5px, transparent 1.5px)', backgroundSize: '16px 16px' }}
                          onMouseDown={handleMapPadMouseDown}
                          onMouseMove={handleMapPadMouseMove}
                          onMouseUp={handleMapPadMouseUp}
                          onMouseLeave={handleMapPadMouseUp}
                          onTouchStart={handleMapPadTouchStart}
                          onTouchMove={handleMapPadTouchMove}
                          onTouchEnd={handleMapPadMouseUp}
                        >
                          {/* Compass indicators */}
                          <div className="absolute inset-4 border border-slate-200/40 rounded-full flex items-center justify-center pointer-events-none">
                            <span className="text-[9px] uppercase font-bold tracking-widest text-slate-300 absolute top-1">North</span>
                            <span className="text-[9px] uppercase font-bold tracking-widest text-slate-300 absolute bottom-1">South</span>
                            <span className="text-[9px] uppercase font-bold tracking-widest text-slate-300 absolute left-1">West</span>
                            <span className="text-[9px] uppercase font-bold tracking-widest text-slate-300 absolute right-1">East</span>
                          </div>

                          {/* Map Pin Draggable */}
                          <motion.div 
                            className="absolute z-10 text-primary bg-white px-3 py-1.5 rounded-full shadow-lg border border-primary/20 flex flex-col items-center gap-0.5"
                            animate={{ scale: isDraggingPin ? 1.12 : 1 }}
                            style={{ cursor: isDraggingPin ? 'grabbing' : 'grab' }}
                          >
                            <MapPin className="h-5 w-5 fill-current text-primary" />
                            <span className="text-[8px] font-bold text-gray-500 font-mono select-none">DRAG DRAG</span>
                          </motion.div>

                          <div className="absolute bottom-2 left-2 bg-slate-900/80 px-2 py-1 rounded-md text-[9px] text-white/90 font-mono">
                            Precision Dragger
                          </div>
                        </div>

                        {/* Joysticks */}
                        <div className="flex flex-col items-center space-y-1">
                          <p className="text-[10px] font-semibold text-gray-500 mb-1">Fine-tune coordinates (Joypad):</p>
                          <button
                            type="button"
                            onClick={() => setProfileLat(prev => String((parseFloat(prev || '33.5731') + 0.0002).toFixed(6)))}
                            className="p-1 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 transition cursor-pointer"
                            title="Nudge North"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                          <div className="flex space-x-3 items-center">
                            <button
                              type="button"
                              onClick={() => setProfileLng(prev => String((parseFloat(prev || '-7.5898') - 0.0002).toFixed(6)))}
                              className="p-1 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 transition cursor-pointer"
                              title="Nudge West"
                            >
                              <ChevronLeft className="h-4 w-4" />
                            </button>
                            <div className="bg-slate-100 text-slate-700 text-[10px] px-2.5 py-1 rounded-md flex items-center font-bold font-mono">
                              NUDGE
                            </div>
                            <button
                              type="button"
                              onClick={() => setProfileLng(prev => String((parseFloat(prev || '-7.5898') + 0.0002).toFixed(6)))}
                              className="p-1 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 transition cursor-pointer"
                              title="Nudge East"
                            >
                              <ChevronRight className="h-4 w-4" />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => setProfileLat(prev => String((parseFloat(prev || '33.5731') - 0.0002).toFixed(6)))}
                            className="p-1 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-700 transition cursor-pointer"
                            title="Nudge South"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      {/* Live Google Maps Iframe Output */}
                      <div className="space-y-4">
                        {profileLat && profileLng && !isNaN(parseFloat(profileLat)) && !isNaN(parseFloat(profileLng)) ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                              <span className="text-xs font-semibold text-gray-700">Displaying on Google Maps:</span>
                            </div>
                            <div className="w-full h-48 rounded-2xl overflow-hidden border border-gray-200 bg-gray-50 shadow-inner">
                              <iframe
                                width="100%"
                                height="100%"
                                frameBorder="0"
                                loading="lazy"
                                allowFullScreen
                                referrerPolicy="no-referrer"
                                src={buildMapEmbedUrl(profileLat, profileLng, language)}
                              ></iframe>
                            </div>
                          </div>
                        ) : (
                          <div className="p-6 bg-red-50/50 rounded-2xl border border-dashed border-red-200 text-center flex flex-col items-center justify-center h-48">
                            <MapPin className="h-6 w-6 text-red-500 mb-2" />
                            <p className="text-xs font-semibold text-red-800">No active coordinates found</p>
                            <p className="text-[10px] text-red-600 mt-0.5">Please click "Detect My Location" or type coordinates above.</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 flex justify-end">
                    <button type="submit" className="w-full bg-gray-900 hover:bg-primary text-white py-3.5 rounded-xl font-medium transition-colors shadow-md shadow-gray-900/10 cursor-pointer">
                      Save Profile & GPS Location
                    </button>
                  </div>
                </form>
              </motion.div>
            )}

            {activeTab === 'support' && (
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 text-right">
                <div className="mb-8 text-right">
                  <h2 className="text-2xl font-display font-black text-gray-900">
                    {language === 'ar' ? 'الدعم الفني والمساعدة' : 'Help & Support'}
                  </h2>
                  <p className="text-xs font-semibold text-gray-500 mt-1 leading-relaxed">
                    {language === 'ar' 
                      ? 'واجهت مشكلة في الطلب أو الموقع؟ أرسل تذكرة دعم وسيتولى مسؤول النظام حل المشكلة والرد عليك.' 
                      : 'Have an issue with your order or pickup? Report it here. Our Admin will analyze and respond promptly.'}
                  </p>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start text-right">
                  {/* Create Ticket Form */}
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    if (!ticketSubject.trim() || !ticketMessage.trim()) {
                      toast.error(language === 'ar' ? 'الرجاء ملء جميع الحقول' : 'Please fill all fields');
                      return;
                    }
                    addSupportTicket(ticketSubject, ticketMessage);
                    setTicketSubject('');
                    setTicketMessage('');
                  }} className="space-y-4 bg-gray-50 p-6 rounded-2xl border border-gray-100">
                    <h3 className="font-extrabold text-sm text-gray-900 uppercase tracking-wide">
                      {language === 'ar' ? 'إنشاء تذكرة دعم جديدة' : 'Submit Support Request'}
                    </h3>
                    
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5 text-right">
                        {language === 'ar' ? 'الموضوع' : 'Subject'}
                      </label>
                      <input
                        type="text"
                        required
                        value={ticketSubject}
                        onChange={(e) => setTicketSubject(e.target.value)}
                        placeholder={language === 'ar' ? 'مثال: مشكلة في استلام الطلب' : 'e.g., Order coordinates incorrect'}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-white text-sm font-semibold text-right"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5 text-right">
                        {language === 'ar' ? 'شرح المشكلة بالتفصيل' : 'Description'}
                      </label>
                      <textarea
                        required
                        rows={4}
                        value={ticketMessage}
                        onChange={(e) => setTicketMessage(e.target.value)}
                        placeholder={language === 'ar' ? 'يرجى تقديم تفاصيل واضحة لنتمكن من مساعدتك بحسم...' : 'Provide clear details to facilitate resolution...'}
                        className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-white text-sm font-medium resize-none text-right"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full bg-gray-950 hover:bg-primary text-white py-3 rounded-xl font-bold transition-all text-xs cursor-pointer shadow-sm uppercase tracking-wide"
                    >
                      {language === 'ar' ? 'إرسال التذكرة للإدارة' : 'Submit Ticket'}
                    </button>
                  </form>

                  {/* Existing Tickets list */}
                  <div className="space-y-4">
                    <h3 className="font-extrabold text-xs text-gray-400 uppercase tracking-widest block text-right">
                      {language === 'ar' ? 'تذاكرك الحالية' : 'Your Ticket History'}
                    </h3>

                    {supportTickets.filter(t => t.userId === user.id).length === 0 ? (
                      <div className="border border-dashed border-gray-200 rounded-2xl p-6 text-center text-xs font-bold text-gray-400">
                        {language === 'ar' ? 'لا توجد تذاكر دعم مسجلة لديك.' : 'No active or past support tickets.'}
                      </div>
                    ) : (
                      supportTickets.filter(t => t.userId === user.id).map(ticket => (
                        <div key={ticket.id} className="border border-gray-200 p-4 rounded-xl space-y-2 bg-white shadow-sm text-right">
                          <div className="flex justify-between items-center mb-1 flex-row-reverse">
                            <h4 className="font-bold text-xs text-gray-900">{ticket.subject}</h4>
                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                              ticket.status === 'resolved' 
                                ? 'bg-emerald-50 text-emerald-800' 
                                : 'bg-rose-50 text-rose-800'
                            }`}>
                              {ticket.status === 'resolved' ? (language === 'ar' ? 'محلولة' : 'Resolved') : (language === 'ar' ? 'معالجة جارية' : 'Pending')}
                            </span>
                          </div>
                          
                          <p className="text-xs text-gray-650 bg-gray-50 p-2.5 rounded-lg font-medium leading-relaxed">
                            {ticket.message}
                          </p>

                          {ticket.status === 'resolved' && (
                            <div className="bg-emerald-50/50 p-3 rounded-lg border border-emerald-100 text-emerald-950 text-right mt-2 text-xs">
                              <p className="font-black mb-1">🛡️ {language === 'ar' ? 'رد مسؤول النظام:' : 'Admin Solution:'}</p>
                              <p className="font-semibold text-emerald-800 leading-relaxed font-sans">{ticket.response}</p>
                            </div>
                          )}
                          
                          <span className="text-[9px] font-mono text-gray-400 block pt-1">
                            {new Date(ticket.createdAt).toLocaleString()}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </div>

      {/* Review Modal */}
      <AnimatePresence>
        {reviewModalOpen && selectedOrderForReview && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl relative"
          >
            <button 
              onClick={() => setReviewModalOpen(false)}
              className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-colors"
            >
              <XCircle className="h-5 w-5" />
            </button>
            
            <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <Star className="h-8 w-8 text-primary" />
            </div>
            
            <h2 className="text-2xl font-display font-bold text-center text-gray-900 mb-2">
              Rate your experience
            </h2>
            <p className="text-center text-gray-500 mb-8">
              How was your meal from {selectedOrderForReview.offerSnapshot.restaurantName}?
            </p>

            <form onSubmit={handleReviewSubmit} className="space-y-6">
              <div className="flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setRating(star)}
                    className={`p-2 transition-colors ${rating >= star ? 'text-yellow-400' : 'text-gray-200 hover:text-yellow-200'}`}
                  >
                    <Star className="h-8 w-8 fill-current" />
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Add a comment (optional)
                </label>
                <div className="relative">
                  <div className="absolute top-3 left-4 flex items-start pointer-events-none">
                    <MessageSquare className="h-5 w-5 text-gray-400" />
                  </div>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={4}
                    className="block w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all bg-gray-50 focus:bg-white resize-none"
                    placeholder="Tell us what you liked..."
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-primary hover:bg-primary-hover text-white py-4 rounded-xl font-medium shadow-md shadow-primary/20 transition-all"
              >
                Submit Review
              </button>
            </form>
          </motion.div>
        </div>
        )}
      </AnimatePresence>

      <ConfirmModal
        isOpen={isProfileModalOpen}
        title={t('confirmSaveChangesTitle')}
        message={t('confirmSaveProfileMsg')}
        confirmText={t('confirmYes')}
        cancelText={t('cancel')}
        onConfirm={confirmSaveSettings}
        onCancel={() => {
          setIsProfileModalOpen(false);
          setPendingProfileData(null);
        }}
      />

      <LocationPermissionModal
        isOpen={isPermissionModalOpen}
        onClose={() => setIsPermissionModalOpen(false)}
        onGrant={handleGrantPermission}
        role="consumer"
      />
    </div>
  );
}
