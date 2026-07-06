import React, { useState } from 'react';
import { useAppContext, isOrderExpired } from '../context/AppContext';
import { Store, Package, TrendingUp, Settings, Plus, Edit2, Trash2, Clock, CheckCircle2, XCircle, Gift, MapPin, Crosshair, Loader2, Mail, Phone, Star, User, CreditCard, Coins, MessageSquare, AlertTriangle } from 'lucide-react';
import { Navigate, Link } from 'react-router-dom';
import { Offer, City, CommerceType } from '../types';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { ConfirmModal } from '../components/ConfirmModal';
import { LocationPermissionModal } from '../components/LocationPermissionModal';
import { uploadImage } from '../lib/cloudinary';
import { buildMapEmbedUrl, buildMapLink } from '../lib/utils';
import { saveOffer, deleteOffer } from '../lib/supabase';

export function RestaurantDashboard() {
  const { user, setUser, setSelectedCity, offers, setOffers, orders, reviews, updateOrderStatus, cancelOrder, supportTickets, addSupportTicket, language, t } = useAppContext();
  const [pickupModalOrderId, setPickupModalOrderId] = useState<string | null>(null);
  const [pickupCodeInput, setPickupCodeInput] = useState('');
  const [pickupCodeError, setPickupCodeError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'offers' | 'orders' | 'profile' | 'reviews' | 'support'>('offers');
  const [isOfferFormOpen, setIsOfferFormOpen] = useState(false);
  const [editingOffer, setEditingOffer] = useState<Offer | null>(null);
  const [isSurpriseBox, setIsSurpriseBox] = useState(false);
  const [offerName, setOfferName] = useState('');
  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [pendingProfileData, setPendingProfileData] = useState<FormData | null>(null);

  // Support inputs
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');
  const [isOfferModalOpen, setIsOfferModalOpen] = useState(false);
  const [pendingOfferData, setPendingOfferData] = useState<FormData | null>(null);

  const [isPermissionModalOpen, setIsPermissionModalOpen] = useState(false);
  const [locationError, setLocationError] = useState<{
    code: number;
    message: string;
    details: string;
  } | null>(null);

  // Live Location State for Partners
  const [profileLat, setProfileLat] = useState(user?.coordinates?.lat !== undefined ? String(user.coordinates.lat) : '');
  const [profileLng, setProfileLng] = useState(user?.coordinates?.lng !== undefined ? String(user.coordinates.lng) : '');

  if (!user || user.role !== 'restaurant') {
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
        let newAddress = 'Location saved';
        const mapLink = buildMapLink(latitude, longitude, language);

        try {
          const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&accept-language=${language}`);
          const data = await response.json();
          if (data && data.display_name) {
            newAddress = data.display_name;
          }
        } catch (error) {
          console.error("Reverse geocoding failed", error);
        }

        setProfileLat(String(latitude.toFixed(6)));
        setProfileLng(String(longitude.toFixed(6)));

        const updatedUser = {
          ...user,
          address: newAddress,
          coordinates: { lat: latitude, lng: longitude },
          mapLink
        };
        setUser(updatedUser);

        // Real-time synchronization: sync location changes to all user offers immediately
        setOffers(prevOffers => prevOffers.map(o => {
          if (o.restaurantId === user.id) {
            return {
              ...o,
              address: newAddress,
              coordinates: { lat: latitude, lng: longitude },
              mapLink
            };
          }
          return o;
        }));

        setIsDetectingLocation(false);
        toast.dismiss(loadingToastId);
        toast.success('📍 Precise partner location solved successfully!');
      },
      (error) => {
        setIsDetectingLocation(false);
        toast.dismiss(loadingToastId);

        let userMessage = "Unable to retrieve your location.";
        let troubleshooting = "Please verify your browser settings and try again.";

        if (error.code === error.PERMISSION_DENIED) {
          userMessage = "Location permission denied. Please allow location access.";
          troubleshooting = "Look for a lock icon 🔒 next to your browser’s URL input field and switch 'Location' to 'Allow'. Once updated, click Retry below to scan coordinates.";
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          userMessage = "Unable to acquire a robust GPS lock.";
          troubleshooting = "Your physical position could not be detected. Please ensure your shop is connected to a secure Wi-Fi node, or enter coordinates manually.";
        } else if (error.code === error.TIMEOUT) {
          userMessage = "Location request took too long and timed out.";
          troubleshooting = "The connection timed out after 10 seconds. Try testing closer to open physical paths, or tap Retry below.";
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

  const handleSaveProfile = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    setPendingProfileData(formData);
    setIsProfileModalOpen(true);
  };

  const confirmSaveProfile = () => {
    if (!pendingProfileData) return;
    const newCity = pendingProfileData.get('city') as City;
    const selectedType = pendingProfileData.get('commerceType') as CommerceType;
    const address = pendingProfileData.get('address') as string;

    // Strict validation for allowed categories
    if (selectedType !== 'Patisserie' && selectedType !== 'Superette' && selectedType !== 'Buffet à volonté') {
      toast.error('Only Patisserie, Superette, and Buffet à volonté are allowed as partners.');
      setIsProfileModalOpen(false);
      setPendingProfileData(null);
      return;
    }

    // Parse latitude and longitude
    const latVal = parseFloat(profileLat);
    const lngVal = parseFloat(profileLng);
    
    let coords = undefined;
    let mapLink = undefined;
    
    if (!isNaN(latVal) && !isNaN(lngVal)) {
      coords = { lat: latVal, lng: lngVal };
      mapLink = buildMapLink(latVal, lngVal, language);
    }

    const updatedUser = {
      ...user,
      name: pendingProfileData.get('name') as string,
      email: pendingProfileData.get('email') as string,
      commerceType: selectedType,
      phone: pendingProfileData.get('phone') as string,
      city: newCity,
      address: address || '',
      coordinates: coords,
      mapLink: mapLink
    };

    setUser(updatedUser);

    // Synchronize to recommended systems/menu items immediately in real-time
    setOffers(prevOffers => prevOffers.map(o => {
      if (o.restaurantId === user.id) {
        return {
          ...o,
          restaurantName: updatedUser.name,
          city: updatedUser.city,
          commerceType: updatedUser.commerceType,
          address: updatedUser.address,
          coordinates: updatedUser.coordinates,
          mapLink: updatedUser.mapLink
        };
      }
      return o;
    }));

    setSelectedCity(newCity);
    setIsProfileModalOpen(false);
    setPendingProfileData(null);
    toast.success('✅ Business profile and location updated across the system!');
  };

  const myOffers = offers.filter(o => o.restaurantId === user.id);
  const myOrders = orders.filter(o => o.restaurantId === user.id);
  const myReviews = reviews.filter(r => r.restaurantId === user.id);
  
  const totalRevenue = myOrders
    .filter(o => o.status !== 'cancelled')
    .reduce((sum, order) => sum + order.totalPrice, 0);

  const averageRating = myReviews.length > 0 
    ? (myReviews.reduce((sum, r) => sum + r.rating, 0) / myReviews.length).toFixed(1)
    : 'New';

  const handleOpenAdd = () => {
    setEditingOffer(null);
    setIsSurpriseBox(false);
    setOfferName('');
    setIsOfferFormOpen(true);
  };

  const handleOpenEdit = (offer: Offer) => {
    setEditingOffer(offer);
    setIsSurpriseBox(offer.isSurpriseBox || false);
    setOfferName(offer.name);
    setIsOfferFormOpen(true);
  };

  const handleCloseForm = () => {
    setIsOfferFormOpen(false);
    setEditingOffer(null);
  };

  const handleSaveOffer = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // An offer inherits the partner's commerce type (line below). Without one it
    // saves as '' and Meals.tsx hides it forever — block early and steer the
    // partner to set it first.
    if (!user.commerceType) {
      toast.error(
        language === 'ar'
          ? 'حدّد نوع النشاط التجاري في ملف العمل قبل نشر العروض.'
          : 'Set your commerce type in the Business Profile tab before publishing offers.',
      );
      setActiveTab('profile');
      return;
    }
    const formData = new FormData(e.currentTarget);
    setPendingOfferData(formData);
    setIsOfferModalOpen(true);
  };

  const confirmSaveOffer = async () => {
    if (!pendingOfferData) return;

    const imageFile = pendingOfferData.get('image') as File;
    let imageUrl = editingOffer ? editingOffer.image : 'https://picsum.photos/seed/newfood/600/400';

    if (imageFile && imageFile.size > 0 && !isSurpriseBox) {
      const uploadingToastId = toast.loading('Uploading image...');
      try {
        imageUrl = await uploadImage(imageFile);
        toast.dismiss(uploadingToastId);
      } catch (err) {
        toast.dismiss(uploadingToastId);
        toast.error(err instanceof Error ? err.message : 'Image upload failed');
        return;
      }
    }

    const mealCategory = pendingOfferData.get('mealCategory') as string;

    const offerData: Offer = {
      id: editingOffer ? editingOffer.id : `off_${Date.now()}`,
      restaurantId: user.id,
      restaurantName: user.name,
      name: isSurpriseBox ? `SecondServe - ${user.commerceType}` : offerName,
      description: pendingOfferData.get('description') as string,
      originalPrice: pendingOfferData.get('originalPrice') as string,
      reducedPrice: pendingOfferData.get('reducedPrice') as string,
      quantity: Number(pendingOfferData.get('quantity')),
      image: isSurpriseBox ? '/second_serve_box.png' : imageUrl,
      timeLimit: pendingOfferData.get('timeLimit') as string,
      city: user.city,
      commerceType: user.commerceType!,
      mealCategory: isSurpriseBox ? 'Box' : mealCategory,
      rating: editingOffer ? editingOffer.rating : 5.0,
      isSurpriseBox: isSurpriseBox,
      address: user.address || '',
      coordinates: user.coordinates,
      mapLink: user.mapLink
    };

    try {
      await saveOffer(offerData, !editingOffer);
      toast.success(editingOffer ? 'Offer updated successfully!' : 'Offer published successfully!');
    } catch (err) {
      console.error('Failed to save offer:', err);
      toast.error('Failed to save offer. Check the console for details.');
      return;
    }

    setIsOfferModalOpen(false);
    setPendingOfferData(null);
    handleCloseForm();
  };

  const handleDeleteOffer = async (offerId: string) => {
    try {
      await deleteOffer(offerId);
      toast.success('Offer deleted');
    } catch (err) {
      console.error('Failed to delete offer:', err);
      toast.error('Failed to delete offer.');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Header */}
        <div className="bg-gray-900 rounded-3xl p-8 shadow-xl mb-8 flex flex-col md:flex-row items-center justify-between gap-6 text-white">
          <div className="flex items-center gap-6">
            <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center text-white font-display font-bold text-3xl border border-white/20">
              <Store className="h-10 w-10" />
            </div>
            <div>
              <h1 className="text-3xl font-display font-bold mb-1">
                {user.name}
              </h1>
              <p className="text-gray-400 flex items-center gap-2">
                {user.commerceType} • {user.city}
              </p>
              {user.address && (
                <p className="text-gray-400 flex items-center gap-1 mt-1 text-sm">
                  <MapPin className="h-3.5 w-3.5" />
                  {user.address}
                </p>
              )}
            </div>
          </div>
          
          <div className="flex flex-wrap gap-2 bg-white/10 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('offers')}
              className={`px-6 py-2.5 rounded-lg font-medium transition-all ${
                activeTab === 'offers' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-300 hover:text-white'
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => setActiveTab('orders')}
              className={`px-6 py-2.5 rounded-lg font-medium transition-all ${
                activeTab === 'orders' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-300 hover:text-white'
              }`}
            >
              Orders
            </button>
            <button
              onClick={() => setActiveTab('profile')}
              className={`px-6 py-2.5 rounded-lg font-medium transition-all ${
                activeTab === 'profile' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-300 hover:text-white'
              }`}
            >
              Business Profile
            </button>
            <button
              onClick={() => setActiveTab('reviews')}
              className={`px-6 py-2.5 rounded-lg font-medium transition-all ${
                activeTab === 'reviews' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-300 hover:text-white'
              }`}
            >
              Reviews
            </button>
            <button
              onClick={() => setActiveTab('support')}
              className={`px-6 py-2.5 rounded-lg font-medium transition-all ${
                activeTab === 'support' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-300 hover:text-white'
              }`}
            >
              {t('navHelpSupport')}
            </button>
          </div>
        </div>

        {/* Visibility gate notice: offers stay hidden from the public Meals
            catalogue until the account is admin-approved AND has a commerce
            type (Meals.tsx filters on both). Surface it so partners aren't left
            wondering why their published offers don't appear. */}
        {(user.approved === false || !user.commerceType) && (
          <div className="bg-amber-50 border border-amber-200 rounded-3xl p-5 mb-8 flex items-start gap-4">
            <AlertTriangle className="h-6 w-6 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-grow">
              <p className="font-bold text-amber-900 text-sm">
                {t('offersNotVisibleYet')}
              </p>
              <ul className="text-xs text-amber-800 mt-1.5 space-y-1 font-semibold list-disc list-inside">
                {user.approved === false && (
                  <li>{t('pendingApprovalReason')}</li>
                )}
                {!user.commerceType && (
                  <li>{t('setCommerceTypeReason')}</li>
                )}
              </ul>
              {!user.commerceType && (
                <button
                  onClick={() => setActiveTab('profile')}
                  className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-xl font-bold transition-all text-xs"
                >
                  <Settings className="h-3.5 w-3.5" />
                  {t('openBusinessProfileBtn')}
                </button>
              )}
            </div>
          </div>
        )}

        {activeTab === 'offers' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm flex items-center gap-4">
                <div className="p-4 bg-secondary/10 text-secondary rounded-2xl">
                  <Package className="h-8 w-8" />
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-500 mb-1">Meals saved</div>
                  <div className="text-3xl font-display font-bold text-gray-900">
                    {myOrders.filter(o => o.status !== 'cancelled').reduce((sum, o) => sum + o.quantity, 0)}
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm flex items-center gap-4">
                <div className="p-4 bg-blue-50 text-blue-600 rounded-2xl">
                  <Clock className="h-8 w-8" />
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-500 mb-1">Active orders</div>
                  <div className="text-3xl font-display font-bold text-gray-900">
                    {myOrders.filter(o => o.status === 'active').length}
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm flex items-center gap-4">
                <div className="p-4 bg-yellow-50 text-yellow-600 rounded-2xl">
                  <Star className="h-8 w-8" />
                </div>
                <div>
                  <div className="text-sm font-medium text-gray-500 mb-1">Average Rating</div>
                  <div className="text-3xl font-display font-bold text-gray-900">
                    {averageRating}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-8">
              {/* Offers Management */}
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-2xl font-display font-bold text-gray-900">Manage Offers</h2>
                  <button 
                    onClick={isOfferFormOpen ? handleCloseForm : handleOpenAdd}
                    className="flex items-center gap-2 bg-primary hover:bg-primary-hover text-white px-5 py-2.5 rounded-xl font-medium transition-colors shadow-sm"
                  >
                    {isOfferFormOpen ? <XCircle className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
                    {isOfferFormOpen ? 'Cancel' : 'Add Offer'}
                  </button>
                </div>

                {isOfferFormOpen && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="bg-white rounded-3xl p-8 border border-gray-100 shadow-lg">
                    <h3 className="text-xl font-display font-bold text-gray-900 mb-6">{editingOffer ? 'Edit Offer' : 'New anti-waste offer'}</h3>
                    <form key={editingOffer ? editingOffer.id : 'new'} onSubmit={handleSaveOffer} className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-gray-700">{t('labelMealName')}</label>
                          <input 
                            required 
                            name="name" 
                            type="text" 
                            value={isSurpriseBox ? `SecondServe - ${user.commerceType}` : offerName}
                            onChange={(e) => {
                              if (!isSurpriseBox) {
                                setOfferName(e.target.value);
                              }
                            }}
                            disabled={isSurpriseBox}
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-secondary focus:border-transparent outline-none transition-all bg-white disabled:bg-gray-100 disabled:text-gray-500" 
                            placeholder="e.g., Surprise Bag" 
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-gray-700">{t('labelMealCategory')}</label>
                          <select 
                            required 
                            name="mealCategory" 
                            value={isSurpriseBox ? 'Box' : (editingOffer?.mealCategory || 'Baked Goods')}
                            onChange={(e) => {}}
                            disabled={isSurpriseBox}
                            className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-secondary focus:border-transparent outline-none transition-all bg-white disabled:bg-gray-100 disabled:text-gray-500"
                          >
                            <option value="Baked Goods">Baked Goods</option>
                            <option value="Groceries">Groceries</option>
                            <option value="Produce">Produce</option>
                            <option value="Box">Box</option>
                            <option value="Other">Other</option>
                          </select>
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <label className="text-sm font-medium text-gray-700">{t('labelDescription')}</label>
                          <textarea required name="description" defaultValue={editingOffer?.description || ''} rows={3} className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-secondary focus:border-transparent outline-none transition-all bg-white" placeholder="What's inside?" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-gray-700">{t('labelOriginalPriceMAD')}</label>
                          <input required name="originalPrice" defaultValue={editingOffer?.originalPrice || ''} type="number" step="any" min="0" className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-secondary focus:border-transparent outline-none transition-all bg-white" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-gray-700">{t('labelDiscountedPriceMAD')}</label>
                          <input required name="reducedPrice" defaultValue={editingOffer?.reducedPrice || ''} type="number" step="any" min="0" className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-secondary focus:border-transparent outline-none transition-all bg-white" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-gray-700">{t('labelAvailableQuantity')}</label>
                          <input required name="quantity" defaultValue={editingOffer?.quantity || ''} type="number" min="1" className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-secondary focus:border-transparent outline-none transition-all bg-white" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-sm font-medium text-gray-700">{t('labelCollectionDeadline')}</label>
                          <input required name="timeLimit" defaultValue={editingOffer?.timeLimit || ''} type="time" className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-secondary focus:border-transparent outline-none transition-all bg-white" />
                        </div>
                        <div className="space-y-1 md:col-span-2">
                          <label className="text-sm font-medium text-gray-700">{t('labelImageUpload')}</label>
                          <input name="image" type="file" accept="image/*" className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-secondary focus:border-transparent outline-none transition-all bg-white file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20" />
                          {editingOffer && <p className="text-xs text-gray-500 mt-2">Leave empty to keep current image.</p>}
                        </div>
                        <div className="md:col-span-2 flex items-start gap-4 bg-primary/5 p-5 rounded-2xl border border-primary/20 mt-2">
                          <div className="flex items-center h-6">
                            <input 
                              id="isSurpriseBox" 
                              name="isSurpriseBox" 
                              type="checkbox" 
                              checked={isSurpriseBox}
                              onChange={(e) => setIsSurpriseBox(e.target.checked)}
                              className="w-5 h-5 text-primary bg-white border-gray-300 rounded focus:ring-primary focus:ring-2" 
                            />
                          </div>
                          <div className="flex flex-col">
                            <label htmlFor="isSurpriseBox" className="font-display font-bold text-gray-900 flex items-center gap-2 cursor-pointer">
                              <Gift className="h-5 w-5 text-primary" />
                              Make this a SecondeServe Box (Surprise Box)
                            </label>
                            <p className="text-sm text-gray-600 mt-1">
                              Customers won't know exactly what's inside. Perfect for a mix of today's unsold items!
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="flex justify-end pt-4">
                        <button type="submit" className="bg-gray-900 hover:bg-primary text-white px-8 py-3 rounded-xl font-medium transition-colors">
                          {editingOffer ? 'Save Changes' : 'Publish Offer'}
                        </button>
                      </div>
                    </form>
                  </motion.div>
                )}

                <div className="space-y-4">
                  {myOffers.length === 0 ? (
                    <div className="text-center py-12 bg-white rounded-3xl border border-gray-100">
                      <Package className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                      <p className="text-gray-500">You have no active offers.</p>
                    </div>
                  ) : (
                    myOffers.map(offer => (
                      <div key={offer.id} className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex flex-col sm:flex-row gap-4 items-center relative overflow-hidden">
                        {offer.isSurpriseBox && (
                          <div className="absolute top-0 right-0 bg-primary text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg z-10 flex items-center gap-1">
                            <Gift className="h-3 w-3" /> SURPRISE BOX
                          </div>
                        )}
                        <img src={offer.image} alt={offer.name} className="w-24 h-24 rounded-xl object-cover" referrerPolicy="no-referrer" />
                        <div className="flex-grow text-center sm:text-left">
                          <h4 className="font-bold text-gray-900 text-lg">{offer.name}</h4>
                          <div className="flex flex-wrap gap-3 text-sm text-gray-500 mt-1 justify-center sm:text-left">
                            <span className="font-medium text-primary">{offer.reducedPrice} MAD</span>
                            <span className="line-through">{offer.originalPrice} MAD</span>
                            <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-700">Left: {offer.quantity}</span>
                            <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5"/> Before {offer.timeLimit}</span>
                          </div>
                        </div>
                        <div className="flex gap-2 w-full sm:w-auto">
                          <button 
                            onClick={() => handleOpenEdit(offer)}
                            className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-4 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-xl transition-colors"
                          >
                            <Edit2 className="h-4 w-4" /> <span className="sm:hidden">Edit</span>
                          </button>
                          <button 
                            onClick={() => handleDeleteOffer(offer.id)}
                            className="flex-1 sm:flex-none flex justify-center items-center gap-2 px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl transition-colors"
                          >
                            <Trash2 className="h-4 w-4" /> <span className="sm:hidden">Delete</span>
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeTab === 'orders' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
            <h2 className="text-2xl font-display font-bold text-gray-900 mb-6 font-semibold">Customer Orders</h2>
            {myOrders.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Package className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p>No orders received yet.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {myOrders.map(order => (
                  <div key={order.id} className="border border-gray-100 bg-white shadow-sm rounded-3xl p-6 hover:shadow-lg transition-all flex flex-col h-full border-t-4 border-t-primary">
                    <div className="flex justify-between items-start mb-4">
                      {(() => {
                        const expired = isOrderExpired(order);
                        const cls = expired
                          ? 'bg-amber-50 text-amber-800 border border-amber-200'
                          : order.status === 'active' ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : order.status === 'completed' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-red-50 text-red-700 border border-red-200';
                        const label = expired ? `⌛ ${t('orderExpiredBadge')}`
                          : order.status === 'active' ? '⏳ Pending'
                          : order.status === 'completed' ? '✅ Completed' : '❌ Cancelled';
                        return <div className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${cls}`}>{label}</div>;
                      })()}
                      <div className="text-[11px] font-mono text-gray-400">
                        {new Date(order.createdAt).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
                      </div>
                    </div>
                    
                    <div className="mb-4 flex-grow space-y-3.5">
                      <div>
                        <h3 className="font-display font-bold text-lg text-gray-900 leading-tight mb-1">{order.offerSnapshot.name}</h3>
                        <p className="text-xs text-gray-500">
                          Quantity: <span className="font-extrabold text-gray-950 font-mono text-sm">{order.quantity}</span> • Total payload: <span className="font-extrabold text-primary font-mono text-sm">{order.totalPrice.toFixed(2)} MAD</span>
                        </p>
                      </div>

                      {/* Payment Mode Alert Widget */}
                      <div className={`p-3 rounded-2xl text-xs space-y-1 ${
                        order.paymentMethod === 'online' 
                          ? 'bg-indigo-50 border border-indigo-100 text-indigo-950'
                          : 'bg-amber-50 border border-amber-100 text-amber-950'
                      }`}>
                        <div className="flex items-center gap-1.5 font-bold text-[11px] uppercase tracking-wider">
                          {order.paymentMethod === 'online' ? (
                            <>
                              <CreditCard className="h-4 w-4 text-indigo-700" />
                              <span>💳 Secure Online Escrow</span>
                            </>
                          ) : (
                            <>
                              <Coins className="h-4 w-4 text-amber-700" />
                              <span>🤝 Pay on Delivery / Cash</span>
                            </>
                          )}
                        </div>
                        <p className="text-[10.5px] leading-relaxed text-gray-600 font-medium">
                          {order.paymentMethod === 'online' ? (
                            order.paymentStatus === 'released' 
                              ? '🟢 Funds have been securely released to your storefront balance.'
                              : '⏳ Funds held in escrow. Will automatically release to you upon tapping "Confirm Delivery".'
                          ) : (
                            '🤝 Storefront checkout chosen. Collect payment in full directly at pickup time.'
                          )}
                        </p>
                      </div>
                      
                      {/* Customer Contact profile block */}
                      <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-2xl space-y-2.5">
                        <div className="flex items-center gap-2 text-sm text-slate-800">
                          <User className="h-4 w-4 text-slate-400 flex-shrink-0" />
                          <span className="font-bold text-xs">{order.consumerName || `Customer ID: ${order.consumerId.substring(0, 8)}`}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-slate-800">
                          <Phone className="h-4 w-4 text-slate-400 flex-shrink-0" />
                          <a href={`tel:${order.consumerPhone}`} className="hover:underline text-xs font-semibold text-primary font-mono">{order.consumerPhone || 'No contact provided'}</a>
                        </div>
                      </div>

                      {/* Optional Customer Message block */}
                      {order.customerMessage ? (
                        <div className="bg-slate-50 border-l-4 border-l-slate-400 p-3 rounded-xl flex gap-2">
                          <MessageSquare className="h-3.5 w-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                          <p className="text-[11px] italic text-slate-600 leading-relaxed font-semibold">
                            "{order.customerMessage}"
                          </p>
                        </div>
                      ) : null}

                      <Link
                        to={`/restaurant/orders/${order.id}`}
                        className="block w-full text-center px-3 py-2 rounded-xl text-[11px] font-bold bg-gray-50 hover:bg-gray-100 text-gray-700 uppercase tracking-wider transition-colors"
                      >
                        {t('viewFullDetailsBtn')}
                      </Link>
                    </div>

                    {order.status === 'active' && (
                      isOrderExpired(order) ? (
                        <div className="mt-auto space-y-2">
                          <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 leading-relaxed font-semibold">
                            ⌛ {t('orderExpiredHint')}
                          </p>
                          <button
                            onClick={() => cancelOrder(order.id)}
                            className="w-full bg-red-50 hover:bg-red-100 text-red-700 py-3 rounded-xl text-xs font-bold transition-all flex justify-center items-center gap-2 uppercase tracking-wider cursor-pointer"
                          >
                            <XCircle className="h-4 w-4" />
                            {t('cancelOrderBtn')}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setPickupModalOrderId(order.id);
                            setPickupCodeInput('');
                            setPickupCodeError(null);
                          }}
                          className="w-full mt-auto bg-gray-950 hover:bg-primary text-white py-3.5 rounded-xl text-xs font-bold transition-all flex justify-center items-center gap-2 shadow-sm uppercase tracking-wider cursor-pointer"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          {t('confirmDeliveryBtn')}
                        </button>
                      )
                    )}
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'profile' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 max-w-2xl">
            <h2 className="text-2xl font-display font-bold text-gray-900 mb-6 font-semibold">Business Information</h2>
            <form className="space-y-6" onSubmit={handleSaveProfile}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('labelBusinessName')}</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Store className="h-5 w-5 text-gray-400" />
                    </div>
                    <input required name="name" type="text" defaultValue={user.name} className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 focus:bg-white transition-all text-gray-950 font-medium" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('labelBusinessTypeStrict')}</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Package className="h-5 w-5 text-gray-400" />
                    </div>
                    <select required name="commerceType" defaultValue={user.commerceType} className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 focus:bg-white transition-all text-gray-950 font-medium">
                      <option value="Patisserie">Patisserie</option>
                      <option value="Superette">Superette</option>
                      <option value="Buffet à volonté">Buffet à volonté</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('labelEmail')}</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Mail className="h-5 w-5 text-gray-400" />
                    </div>
                    <input required name="email" type="email" defaultValue={user.email} className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 focus:bg-white transition-all text-gray-950 font-medium" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('labelPhone')}</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Phone className="h-5 w-5 text-gray-400" />
                    </div>
                    <input required name="phone" type="tel" defaultValue={user.phone} className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 focus:bg-white transition-all text-gray-950 font-medium" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('labelCity')}</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <MapPin className="h-5 w-5 text-gray-400" />
                    </div>
                    <select required name="city" defaultValue={user.city} className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 focus:bg-white transition-all text-gray-950 font-medium">
                      <option value="Casablanca">Casablanca</option>
                      <option value="Mohammedia">Mohammedia</option>
                    </select>
                  </div>
                </div>

                <div className="md:col-span-2 pt-6 border-t border-gray-100 space-y-4">
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-lg font-display font-bold text-gray-900">{t('labelPartnerLocationStrict')}</label>
                    <button 
                      type="button"
                      onClick={handleOpenPermissionModal}
                      disabled={isDetectingLocation}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-primary/10 text-primary hover:bg-primary/25 rounded-xl transition-all disabled:opacity-50 cursor-pointer"
                    >
                      {isDetectingLocation ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
                      {isDetectingLocation ? 'Detecting...' : 'Autodetect Location (GPS)'}
                    </button>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('labelStreetAddress')}</label>
                    <div className="relative">
                      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                        <MapPin className="h-5 w-5 text-gray-400" />
                      </div>
                      <input 
                        required 
                        name="address" 
                        type="text" 
                        defaultValue={user.address || ''} 
                        className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 focus:bg-white transition-all text-gray-950 font-medium"
                        placeholder="e.g. 123 Rue de la Gare, Casablanca"
                      />
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

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('labelLatitude')}</label>
                      <input 
                        required
                        type="number" 
                        step="any"
                        value={profileLat}
                        onChange={(e) => setProfileLat(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 focus:bg-white transition-all text-gray-950 font-medium" 
                        placeholder="33.5866"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('labelLongitude')}</label>
                      <input 
                        required
                        type="number" 
                        step="any"
                        value={profileLng}
                        onChange={(e) => setProfileLng(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-gray-50 focus:bg-white transition-all text-gray-950 font-medium" 
                        placeholder="-7.6322"
                      />
                    </div>
                  </div>

                  {profileLat && profileLng && !isNaN(parseFloat(profileLat)) && !isNaN(parseFloat(profileLng)) ? (
                    <div className="space-y-4">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        <p className="text-xs text-gray-500 font-medium">Real-time Location Map Preview:</p>
                      </div>
                      <div className="w-full h-64 rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                        <iframe
                          width="100%"
                          height="100%"
                          style={{ border: 0 }}
                          loading="lazy"
                          allowFullScreen
                          referrerPolicy="no-referrer-when-downgrade"
                          src={buildMapEmbedUrl(profileLat, profileLng, language)}
                        ></iframe>
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 bg-red-50/50 rounded-2xl border border-dashed border-red-200 text-center">
                      <MapPin className="h-6 w-6 text-red-500 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-red-800">No active coordinates found</p>
                      <p className="text-xs text-red-600 mt-0.5">Please click "Autodetect Location (GPS)" or fill in the Latitude and Longitude values manually above.</p>
                    </div>
                  )}
                </div>
              </div>
              <div className="pt-4 flex justify-end">
                <button type="submit" className="w-full bg-gray-900 hover:bg-primary text-white py-3.5 rounded-xl font-medium transition-colors shadow-md">
                  Save Business Changes
                </button>
              </div>
            </form>
          </motion.div>
        )}
        {activeTab === 'reviews' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-display font-bold text-gray-900">Customer Reviews</h2>
              <div className="flex items-center gap-2 bg-yellow-50 text-yellow-700 px-4 py-2 rounded-xl font-medium">
                <Star className="h-5 w-5 fill-current" />
                {averageRating} ({myReviews.length} reviews)
              </div>
            </div>

            {myReviews.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Star className="h-12 w-12 mx-auto mb-4 text-gray-300" />
                <p>You don't have any reviews yet.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {myReviews.map(review => {
                  const offer = myOffers.find(o => o.id === review.offerId);
                  return (
                    <div key={review.id} className="border border-gray-100 rounded-2xl p-6 hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-start mb-4">
                        <div>
                          <h3 className="font-bold text-lg text-gray-900">{review.consumerName}</h3>
                          <p className="text-sm text-gray-500">
                            Ordered: <span className="font-medium text-gray-700">{offer?.name || 'Unknown Item'}</span>
                          </p>
                        </div>
                        <div className="flex items-center text-yellow-500 bg-yellow-50 px-3 py-1 rounded-full">
                          <Star className="h-4 w-4 fill-current" />
                          <span className="text-sm font-bold ml-1">{review.rating}</span>
                        </div>
                      </div>
                      {review.comment && (
                        <p className="text-gray-700 bg-gray-50 p-4 rounded-xl">{review.comment}</p>
                      )}
                      <div className="text-sm text-gray-400 mt-4">
                        {new Date(review.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </motion.div>
        )}

        {activeTab === 'support' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 text-right" dir={language === 'ar' ? 'rtl' : 'ltr'}>
            <div className="mb-8 text-right">
              <h2 className="text-2xl font-display font-black text-gray-900">
                {t('businessHelpSupportHeading')}
              </h2>
              <p className="text-xs font-semibold text-gray-500 mt-1 leading-relaxed">
                {language === 'ar' 
                  ? 'هل تواجه مشكلة في تفعيل حجزك، أو إضافة منتج، أو إعدادات الموقع الجغرافي؟ أرسل تذكرة دعم وسيتولى مسؤول النظام الإجابة.' 
                  : 'Encountered a business account, billing, product launch, or location settings issue? Contact our Admin Support desk.'}
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start text-right">
              {/* Create Ticket Form */}
              <form onSubmit={(e) => {
                e.preventDefault();
                if (!ticketSubject.trim() || !ticketMessage.trim()) {
                  toast.error(t('fillAllFieldsToast'));
                  return;
                }
                addSupportTicket(ticketSubject, ticketMessage);
                setTicketSubject('');
                setTicketMessage('');
              }} className="space-y-4 bg-gray-50 p-6 rounded-2xl border border-gray-100">
                <h3 className="font-extrabold text-sm text-gray-900 uppercase tracking-wide">
                  {t('submitSupportRequestBtn')}
                </h3>
                
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5 text-right">
                    {t('subjectLabel')}
                  </label>
                  <input
                    type="text"
                    required
                    value={ticketSubject}
                    onChange={(e) => setTicketSubject(e.target.value)}
                    placeholder={t('subjectPlaceholderBiz')}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-white text-sm font-semibold text-right"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5 text-right">
                    {t('descriptionLabel')}
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={ticketMessage}
                    onChange={(e) => setTicketMessage(e.target.value)}
                    placeholder={t('descriptionPlaceholderBiz')}
                    className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-primary focus:border-transparent outline-none bg-white text-sm font-medium resize-none text-right"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full bg-gray-950 hover:bg-primary text-white py-3 rounded-xl font-bold transition-all text-xs cursor-pointer shadow-sm uppercase tracking-wide"
                >
                  {t('submitTicketBtn')}
                </button>
              </form>

              {/* Existing Tickets list */}
              <div className="space-y-4">
                <h3 className="font-extrabold text-xs text-gray-400 uppercase tracking-widest block text-right">
                  {t('ticketHistoryHeadingBiz')}
                </h3>

                {supportTickets.filter(t => t.userId === user.id).length === 0 ? (
                  <div className="border border-dashed border-gray-200 rounded-2xl p-6 text-center text-xs font-bold text-gray-400">
                    {t('noTicketsMsgBiz')}
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
                          {ticket.status === 'resolved' ? t('ticketResolvedBadge') : t('ticketPendingBadge')}
                        </span>
                      </div>
                      
                      <p className="text-xs text-gray-650 bg-gray-50 p-2.5 rounded-lg font-medium leading-relaxed font-sans">
                        {ticket.message}
                      </p>

                      {ticket.status === 'resolved' && (
                        <div className="bg-emerald-50/50 p-3 rounded-lg border border-emerald-100 text-emerald-950 text-right mt-2 text-xs">
                          <p className="font-black mb-1">🛡️ {t('adminSolutionLabel')}</p>
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

      <ConfirmModal
        isOpen={isProfileModalOpen}
        title={t('confirmSaveChangesTitle')}
        message={t('confirmSaveProfileMsg')}
        confirmText={t('confirmYes')}
        cancelText={t('cancel')}
        onConfirm={confirmSaveProfile}
        onCancel={() => {
          setIsProfileModalOpen(false);
          setPendingProfileData(null);
        }}
      />

      <ConfirmModal
        isOpen={isOfferModalOpen}
        title={editingOffer ? t('confirmUpdateProductTitle') : t('confirmPublishProductTitle')}
        message={editingOffer ? t('confirmUpdateProductMsg') : t('confirmPublishProductMsg')}
        confirmText={t('confirmYes')}
        cancelText={t('cancel')}
        onConfirm={confirmSaveOffer}
        onCancel={() => {
          setIsOfferModalOpen(false);
          setPendingOfferData(null);
        }}
      />

      <AnimatePresence>
        {pickupModalOrderId && (() => {
          const targetOrder = orders.find(o => o.id === pickupModalOrderId);
          if (!targetOrder) return null;
          const closeModal = () => {
            setPickupModalOrderId(null);
            setPickupCodeInput('');
            setPickupCodeError(null);
          };
          const submit = async () => {
            const expected = (targetOrder.pickupCode || '').trim();
            const entered = pickupCodeInput.trim();
            if (!expected || entered !== expected) {
              setPickupCodeError(t('pickupCodeInvalid'));
              return;
            }
            await updateOrderStatus(targetOrder.id, 'completed');
            closeModal();
          };
          return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" dir={language === 'ar' ? 'rtl' : 'ltr'}>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-white rounded-3xl shadow-xl w-full max-w-sm overflow-hidden relative p-6"
              >
                <div className="w-14 h-14 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="h-7 w-7" />
                </div>
                <h3 className="text-xl font-display font-bold text-gray-900 text-center mb-1">{t('pickupCodeTitle')}</h3>
                <p className="text-xs text-gray-500 text-center mb-5 leading-relaxed font-semibold">
                  {t('pickupCodeEnterPrompt')}
                </p>
                <input
                  autoFocus
                  inputMode="numeric"
                  maxLength={4}
                  value={pickupCodeInput}
                  onChange={(e) => {
                    setPickupCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4));
                    setPickupCodeError(null);
                  }}
                  placeholder={t('pickupCodePlaceholder')}
                  className="w-full text-center font-mono text-3xl font-black tracking-[0.5em] py-4 border-2 border-gray-200 focus:border-primary focus:ring-2 focus:ring-primary/30 outline-none rounded-xl bg-gray-50"
                />
                {pickupCodeError && (
                  <p className="text-xs text-red-600 mt-2 font-semibold text-center">{pickupCodeError}</p>
                )}
                <div className="flex gap-3 mt-5">
                  <button
                    onClick={closeModal}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-900 px-4 py-3 rounded-xl font-bold text-sm transition-colors"
                  >
                    {t('pickupCodeCancelBtn')}
                  </button>
                  <button
                    onClick={submit}
                    disabled={pickupCodeInput.length !== 4}
                    className="flex-1 bg-primary hover:bg-primary/90 text-white px-4 py-3 rounded-xl font-bold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('pickupCodeConfirmBtn')}
                  </button>
                </div>
              </motion.div>
            </div>
          );
        })()}
      </AnimatePresence>

      <LocationPermissionModal
        isOpen={isPermissionModalOpen}
        onClose={() => setIsPermissionModalOpen(false)}
        onGrant={handleGrantPermission}
        role="restaurant"
      />
    </div>
  );
}
