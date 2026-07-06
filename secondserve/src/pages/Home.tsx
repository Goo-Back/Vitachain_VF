import React, { useState, useMemo } from 'react';
import { Search, Utensils, Store, ShoppingBag, ArrowRight, Users, Leaf, MapPin, Map } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { OfferCard } from '../components/OfferCard';
import { CommerceType } from '../types';
import { motion } from 'motion/react';
import { Link, useNavigate } from 'react-router-dom';

export function Home() {
  const { offers, selectedCity, language, t, users } = useAppContext();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<CommerceType | 'All'>('All');
  const navigate = useNavigate();

  const handleSearch = () => {
    navigate(`/meals?q=${encodeURIComponent(searchQuery)}`);
  };

  const categories: { name: CommerceType | 'All'; label: string; icon: React.ReactNode }[] = [
    { name: 'All', label: t('categoryAll'), icon: <Utensils className="h-5 w-5" /> },
    { name: 'Patisserie', label: t('patisserie'), icon: <ShoppingBag className="h-5 w-5" /> },
    { name: 'Superette', label: t('superette'), icon: <Store className="h-5 w-5" /> },
    { name: 'Buffet à volonté', label: t('buffet'), icon: <Utensils className="h-5 w-5" /> },
  ];

  const filteredOffers = useMemo(() => {
    return offers.filter(offer => {
      const partner = users.find(u => u.id === offer.restaurantId);
      if (partner) {
        if (partner.banned || !partner.approved) {
          return false;
        }
      }

      if (offer.commerceType !== 'Patisserie' && offer.commerceType !== 'Superette' && offer.commerceType !== 'Buffet à volonté') {
        return false;
      }
      const matchesCity = selectedCity ? offer.city === selectedCity : true;
      const matchesCategory = selectedCategory === 'All' ? true : offer.commerceType === selectedCategory;
      const matchesSearch = offer.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                            offer.restaurantName.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCity && matchesCategory && matchesSearch;
    });
  }, [offers, selectedCity, selectedCategory, searchQuery, users]);

  const isRTL = language === 'ar';

  return (
    <div className="flex flex-col min-h-screen text-right" dir={isRTL ? 'rtl' : 'ltr'}>
      {/* Hero Section */}
      <section className="relative pt-24 pb-32 overflow-hidden bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className={`flex flex-col ${isRTL ? 'lg:flex-row-reverse' : 'lg:flex-row'} items-center gap-12 lg:gap-20`}>
            
            {/* Text Content */}
            <div className={`flex-1 ${isRTL ? 'text-right' : 'text-left'}`}>
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary/10 text-secondary font-bold text-sm mb-6"
              >
                <Leaf className="h-4 w-4 text-emerald-600" />
                <span>{isRTL ? 'أنقذ الطعام • وفر المال • الخيار البيئي' : 'Save food • Save money • Eco-friendly'}</span>
              </motion.div>
              
              <motion.h1 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="text-4xl md:text-5xl lg:text-6xl font-display font-black text-gray-900 tracking-tight mb-6 leading-tight"
              >
                {isRTL ? (
                  <>
                    أنقذوا الطعام،<br />
                    <span className="text-primary">وفروا مالكم،</span><br />
                    واحموا جهة المحيط.
                  </>
                ) : (
                  <>
                    Save food.<br />
                    <span className="text-primary">Save money.</span><br />
                    Save planet.
                  </>
                )}
              </motion.h1>
              
              <motion.p 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className="text-base md:text-lg text-gray-500 mb-10 leading-relaxed max-w-2xl font-bold font-medium"
              >
                {t('homeHeroSub')}
              </motion.p>

              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="flex flex-col sm:flex-row items-center gap-4 justify-start"
              >
                <button 
                  onClick={() => navigate('/meals')}
                  className="w-full sm:w-auto px-8 py-4 bg-primary hover:bg-primary-hover text-white rounded-full font-black text-base transition-all shadow-lg shadow-primary/30 hover:shadow-xl hover:-translate-y-0.5 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>{t('homeHeroCTA')}</span>
                  <ArrowRight className={`h-5 w-5 ${isRTL ? 'rotate-180' : ''}`} />
                </button>
                <button 
                  onClick={() => navigate('/auth?type=business')}
                  className="w-full sm:w-auto px-8 py-4 bg-white hover:bg-gray-50 text-gray-900 border border-gray-200 rounded-full font-bold text-base transition-all shadow-sm hover:shadow-md flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Store className="h-5 w-5 text-gray-500" />
                  <span>{isRTL ? 'الانضمام كشريك موفر (مخبزة/سوبرماركت)' : 'Join as Business Partner'}</span>
                </button>
              </motion.div>
            </div>

            {/* Image Content */}
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, x: 20 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              transition={{ delay: 0.4, duration: 0.5 }}
              className="flex-1 w-full max-w-lg lg:max-w-none relative"
            >
              <div className="relative rounded-[2rem] overflow-hidden shadow-2xl shadow-gray-250 border border-gray-100 aspect-[4/3] lg:aspect-square">
                <img 
                  src="https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=1200&q=80" 
                  alt="Eco-friendly food box with fresh produce" 
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-tr from-primary/15 to-transparent mix-blend-overlay"></div>
                <div className={`absolute bottom-6 ${isRTL ? 'right-6' : 'left-6'} bg-white/95 backdrop-blur-sm p-4 rounded-2xl shadow-lg border border-white/50 flex items-center gap-4`}>
                  <div className="bg-green-100 p-3 rounded-xl text-green-600">
                     <Leaf className="h-6 w-6" />
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-black text-gray-900">{isRTL ? 'خيار بيئي ذكي' : 'Eco-Friendly Choice'}</p>
                    <p className="text-[10px] text-gray-500 font-semibold">{isRTL ? 'حد والتقليل من هدر طعام المغرب' : 'Morocco food rescue champion'}</p>
                  </div>
                </div>
              </div>
              
              <div className="absolute -top-10 -right-10 w-64 h-64 bg-secondary/15 rounded-full blur-3xl -z-10"></div>
              <div className="absolute -bottom-10 -left-10 w-64 h-64 bg-primary/15 rounded-full blur-3xl -z-10"></div>
            </motion.div>

          </div>
        </div>
      </section>

      {/* How it Works Section */}
      <section id="how-it-works" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-display font-black text-gray-900 mb-4">
              {isRTL ? 'كيف يعمل سيكوند سيرف؟' : 'How SecondServe Works'}
            </h2>
            <p className="text-gray-500 max-w-2xl mx-auto text-base font-semibold">
              {isRTL ? 'خطوات بسيطة لإنقاذ الوجبات اللذيذة وتوفير ميزانية الأكل وحماية الكوكب.' : 'Save food, save money, and help the environment in 4 simple steps.'}
            </p>
          </div>
          
          <div className={`grid grid-cols-1 md:grid-cols-4 gap-12 relative ${isRTL ? 'flex-row-reverse' : ''}`}>
            {/* Connecting line */}
            <div className="hidden md:block absolute top-12 left-[12.5%] right-[12.5%] h-0.5 bg-gray-100 -z-10"></div>
            
            {/* Step 1 */}
            <div className="text-center relative">
              <div className="w-24 h-24 bg-white border-4 border-primary/20 rounded-full flex items-center justify-center mx-auto mb-6 text-primary shadow-xl shadow-primary/10 relative z-10">
                <Store className="h-10 w-10 text-primary" />
                <div className={`absolute -top-2 ${isRTL ? '-left-2' : '-right-2'} w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center font-bold border-4 border-white`}>1</div>
              </div>
              <h3 className="font-display font-black text-lg mb-3 text-gray-900">{isRTL ? 'المتاجر تنشر العروض' : 'Partners Publish'}</h3>
              <p className="text-sm text-gray-500 leading-relaxed font-semibold">
                {isRTL ? 'تقوم المخابز والمتاجر برصد الأكل الفائض الطازج ونشره بخصم فوري.' : 'Stores and cafes list active delicious unsold surplus items.'}
              </p>
            </div>
            
            {/* Step 2 */}
            <div className="text-center relative">
              <div className="w-24 h-24 bg-white border-4 border-secondary/20 rounded-full flex items-center justify-center mx-auto mb-6 text-secondary shadow-xl shadow-secondary/10 relative z-10">
                <Search className="h-10 w-10 text-secondary" />
                <div className={`absolute -top-2 ${isRTL ? '-left-2' : '-right-2'} w-8 h-8 bg-secondary text-white rounded-full flex items-center justify-center font-bold border-4 border-white`}>2</div>
              </div>
              <h3 className="font-display font-black text-lg mb-3 text-gray-900">{isRTL ? 'تصفح الوجبات مجاوراً' : 'Browse Offers'}</h3>
              <p className="text-sm text-gray-500 leading-relaxed font-semibold">
                {isRTL ? 'ابحث وشاهد العروض والمخبوزات المتاحة حول موقعك الجغرافي مباشرة.' : 'Check fresh delicious surplus boxes nearby based on your GPS.'}
              </p>
            </div>
            
            {/* Step 3 */}
            <div className="text-center relative">
              <div className="w-24 h-24 bg-white border-4 border-amber-500/20 rounded-full flex items-center justify-center mx-auto mb-6 text-amber-500 shadow-xl shadow-amber-500/10 relative z-10">
                <ShoppingBag className="h-10 w-10 text-amber-500" />
                <div className={`absolute -top-2 ${isRTL ? '-left-2' : '-right-2'} w-8 h-8 bg-amber-500 text-white rounded-full flex items-center justify-center font-bold border-4 border-white`}>3</div>
              </div>
              <h3 className="font-display font-black text-lg mb-3 text-gray-900">{isRTL ? 'الحجز والدفع المرن' : 'Reserve & Order'}</h3>
              <p className="text-sm text-gray-500 leading-relaxed font-semibold">
                {isRTL ? 'احجز علبتك المفضلة واختر دفعاً بنكياً مضموناً أو ادفع نقداً في المحل.' : 'Lock in your order securely via bank card escrow or pay cash.'}
              </p>
            </div>
            
            {/* Step 4 */}
            <div className="text-center relative">
              <div className="w-24 h-24 bg-white border-4 border-blue-500/20 rounded-full flex items-center justify-center mx-auto mb-6 text-blue-500 shadow-xl shadow-blue-500/10 relative z-10">
                <MapPin className="h-10 w-10 text-blue-500" />
                <div className={`absolute -top-2 ${isRTL ? '-left-2' : '-right-2'} w-8 h-8 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold border-4 border-white`}>4</div>
              </div>
              <h3 className="font-display font-black text-lg mb-3 text-gray-900">{isRTL ? 'الاستلام والإنقاذ' : 'Pickup & Enjoy'}</h3>
              <p className="text-sm text-gray-500 leading-relaxed font-semibold">
                {isRTL ? 'توجه للعنوان المحدد واستلم علبتك الساخنة قبل انتهاء الصلاحية المحددة بالخريطة.' : 'Collect your surprise food at the storefront and save.'}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content */}
      <section id="offres" className="py-20 bg-gray-50 flex-grow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={`flex flex-col md:flex-row justify-between items-end mb-12 gap-6 ${isRTL ? 'md:flex-row-reverse' : ''}`}>
            <div className="text-right">
              <h2 className="text-3xl md:text-4xl font-display font-black text-gray-900 mb-4">
                {isRTL ? (
                  <>العروض المتوفرة اليوم {selectedCity && <span>في <span className="text-primary">{selectedCity === 'Casablanca' ? 'الدار البيضاء' : 'المحمدية'}</span></span>}</>
                ) : (
                  <>Today's offers {selectedCity && <span className="text-primary">in {selectedCity}</span>}</>
                )}
              </h2>
              <p className="text-gray-500 max-w-2xl font-semibold text-sm">
                {isRTL ? 'أنقذوا هذه الوجبات الشهية بأسعار خيالية قبل نفاد الكمية! الأسبقية للأول.' : "Rescue these delicious meals before it's too late. First come, first served!"}
              </p>
            </div>
            
            {/* Categories */}
            <div className="flex overflow-x-auto hide-scrollbar gap-2 pb-2 w-full md:w-auto flex-row-reverse">
              {categories.map((category) => (
                <button
                  key={category.name}
                  onClick={() => setSelectedCategory(category.name)}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-full whitespace-nowrap transition-all font-bold text-sm border cursor-pointer ${
                    selectedCategory === category.name
                      ? 'bg-gray-900 text-white border-gray-900 shadow-md animate-pulse'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {category.icon}
                  <span>{category.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Offers Grid */}
          {filteredOffers.length > 0 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
                {filteredOffers.slice(0, 8).map((offer) => (
                  <OfferCard key={offer.id} offer={offer} />
                ))}
              </div>
              <div className="mt-12 text-center">
                <Link 
                  to="/meals" 
                  className="inline-flex items-center gap-2 bg-white border border-gray-200 hover:border-primary text-gray-700 hover:text-primary px-8 py-4 rounded-xl font-bold transition-all shadow-sm hover:shadow-md cursor-pointer text-sm"
                >
                  <span>{isRTL ? 'عرض جميع الوجبات وعقد الشراكات' : 'View All Meals'}</span>
                  <ArrowRight className={`h-5 w-5 ${isRTL ? 'rotate-180' : ''}`} />
                </Link>
              </div>
            </>
          ) : (
            <div className="text-center py-20 bg-white rounded-[2rem] border border-gray-100 shadow-sm">
              <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
                <Search className="h-10 w-10 text-gray-300" />
              </div>
              <h3 className="text-2xl font-display font-black text-gray-900 mb-2">{t('noProductsFound')}</h3>
              <p className="text-gray-500 max-w-md mx-auto text-xs font-semibold">
                {isRTL ? 'جرب تغيير المدينة أو فئة المنتجات لرؤية المزيد.' : 'Try changing the category or selected city in the dropdown.'}
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Stats Section */}
      <section className="py-16 bg-gray-950 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className={`grid grid-cols-1 md:grid-cols-3 gap-8 divide-y md:divide-y-0 md:divide-x ${isRTL ? 'md:divide-x-reverse' : ''} divide-gray-800`}>
            <div className="text-center py-4">
              <div className="flex justify-center mb-4">
                <div className="p-3 bg-primary/20 rounded-2xl">
                  <ShoppingBag className="h-8 w-8 text-primary" />
                </div>
              </div>
              <div className="text-4xl font-display font-black mb-2 font-mono">{t('statsRescued')}</div>
              <div className="text-gray-400 font-bold text-sm">{t('statsRescuedLabel')}</div>
            </div>
            
            <div className="text-center py-4">
              <div className="flex justify-center mb-4">
                <div className="p-3 bg-secondary/20 rounded-2xl">
                  <Leaf className="h-8 w-8 text-secondary" />
                </div>
              </div>
              <div className="text-4xl font-display font-black mb-2 font-mono">{t('statsCo2')}</div>
              <div className="text-gray-400 font-bold text-sm">{t('statsCo2Label')}</div>
            </div>

            <div className="text-center py-4">
              <div className="flex justify-center mb-4">
                <div className="p-3 bg-amber-500/20 rounded-2xl">
                  <Store className="h-8 w-8 text-amber-500" />
                </div>
              </div>
              <div className="text-4xl font-display font-black mb-2 font-mono">{t('statsActivePartners')}</div>
              <div className="text-gray-400 font-bold text-sm">{t('statsPartnersLabel')}</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
