import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MapPin, User as UserIcon, LogOut, Menu, X, Bell, Globe } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { toast } from 'sonner';
import { ConfirmModal } from './ConfirmModal';
import { supabase } from '../lib/supabase';

export function Navbar() {
  const { 
    user, 
    setUser, 
    selectedCity, 
    setSelectedCity, 
    language, 
    setLanguage, 
    t,
    notifications,
    markNotificationAsRead,
    clearAllNotifications
  } = useAppContext();

  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [isLangDropdownOpen, setIsLangDropdownOpen] = useState(false);
  const [isNotificationDropdownOpen, setIsNotificationDropdownOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setIsLogoutModalOpen(false);
    toast.success(language === 'ar' ? '✅ تم تسجيل الخروج بنجاح' : '✅ Logged out successfully');
    navigate('/');
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <nav className="sticky top-0 z-40 w-full bg-white/95 backdrop-blur-md border-b border-gray-100 shadow-sm" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-20">
          
          <div className="flex items-center">
            <Link to="/" className="flex items-center gap-2">
              <img src="/logo.png" alt="SecondServe Logo" className="h-10 w-auto object-contain" />
            </Link>
          </div>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center space-x-6 gap-2">
            
            <Link 
              to="/meals" 
              className="text-sm font-bold text-gray-700 hover:text-primary transition-colors px-3 py-2"
            >
              {t('meals')}
            </Link>

            {user && user.role === 'admin' && (
              <Link 
                to="/admin/dashboard" 
                className="text-xs font-black text-indigo-700 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 transition-colors px-3.5 py-1.5 rounded-full"
              >
                {language === 'ar' ? 'لوحة المسؤول 🛡️' : 'Admin Panel 🛡️'}
              </Link>
            )}

            {selectedCity && (
              <button 
                onClick={() => setSelectedCity('')}
                className="flex items-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-primary transition-colors bg-gray-50 px-3.5 py-1.5 rounded-full border border-gray-200"
              >
                <MapPin className="h-4 w-4 text-primary" />
                <span>{selectedCity === 'Casablanca' ? t('casablanca') : selectedCity === 'Mohammedia' ? t('mohammedia') : selectedCity}</span>
              </button>
            )}

            {/* Language Switcher Dropdown */}
            <div className="relative">
              <button
                onClick={() => {
                  setIsLangDropdownOpen(!isLangDropdownOpen);
                  setIsNotificationDropdownOpen(false);
                }}
                className="flex items-center gap-1.5 text-sm font-bold text-gray-700 hover:text-primary transition-colors border border-gray-100 rounded-full px-3 py-1.5 shadow-sm hover:shadow-md cursor-pointer"
                aria-label="Toggle language menu"
              >
                <Globe className="h-4 w-4 text-gray-500" />
                <span>{language === 'en' ? 'EN 🇬🇧' : 'العربية 🇸🇦'}</span>
              </button>

              {isLangDropdownOpen && (
                <div 
                  className={`absolute mt-2 w-36 bg-white rounded-2xl border border-gray-100 shadow-xl z-50 py-1.5 ${
                    language === 'ar' ? 'left-0' : 'right-0'
                  }`}
                >
                  <button
                    onClick={() => {
                      setLanguage('en');
                      setIsLangDropdownOpen(false);
                    }}
                    className={`flex items-center gap-2 w-full text-left px-4 py-2 text-xs font-bold hover:bg-slate-50 transition-colors ${
                      language === 'en' ? 'text-primary' : 'text-gray-700'
                    }`}
                  >
                    <span>🇬🇧 English</span>
                  </button>
                  <button
                    onClick={() => {
                      setLanguage('ar');
                      setIsLangDropdownOpen(false);
                    }}
                    className={`flex items-center gap-2 w-full text-right px-4 py-2 text-xs font-bold hover:bg-slate-50 transition-colors ${
                      language === 'ar' ? 'text-primary' : 'text-gray-700'
                    }`}
                  >
                    <span>🇸🇦 العربية</span>
                  </button>
                </div>
              )}
            </div>

            {/* Active Partner real-time Notification Bell dropdown */}
            {user && user.role === 'restaurant' && (
              <div className="relative">
                <button
                  onClick={() => {
                    setIsNotificationDropdownOpen(!isNotificationDropdownOpen);
                    setIsLangDropdownOpen(false);
                  }}
                  className="relative p-2.5 text-gray-600 hover:text-primary hover:bg-slate-50 rounded-full transition-all border border-gray-100 cursor-pointer shadow-sm"
                  title={t('bellTooltip')}
                >
                  <Bell className="h-5 w-5" />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white ring-2 ring-white animate-pulse">
                      {unreadCount}
                    </span>
                  )}
                </button>

                {isNotificationDropdownOpen && (
                  <div 
                    className={`absolute mt-2 w-80 bg-white rounded-3xl border border-gray-100 shadow-2xl z-50 py-3 overflow-hidden ${
                      language === 'ar' ? 'left-0' : 'right-0'
                    }`}
                  >
                    <div className="flex items-center justify-between px-4 pb-2 border-b border-gray-100">
                      <h4 className="text-xs font-black uppercase text-gray-900 tracking-wider">
                        {language === 'ar' ? 'التنبيهات المباشرة' : 'Real-time Orders'}
                      </h4>
                      {notifications.length > 0 && (
                        <button 
                          onClick={() => {
                            clearAllNotifications();
                            toast.success(language === 'ar' ? 'تم مسح التنبيهات' : 'Notifications cleared');
                          }} 
                          className="text-[10px] font-bold text-red-500 hover:underline"
                        >
                          {language === 'ar' ? 'حذف الكل' : 'Clear All'}
                        </button>
                      )}
                    </div>

                    <div className="max-h-64 overflow-y-auto divide-y divide-gray-50">
                      {notifications.length === 0 ? (
                        <div className="py-8 text-center text-xs text-gray-400 font-semibold">
                          {t('noNotifications')}
                        </div>
                      ) : (
                        notifications.map((notif) => (
                          <div 
                            key={notif.id} 
                            onClick={() => {
                              markNotificationAsRead(notif.id);
                              navigate('/restaurant-dashboard');
                              setIsNotificationDropdownOpen(false);
                            }}
                            className={`p-3.5 hover:bg-slate-50 transition-colors cursor-pointer text-right ${
                              !notif.read ? 'bg-indigo-50/40' : ''
                            }`}
                          >
                            <div className="flex justify-between items-start gap-2 mb-1">
                              <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${
                                notif.paymentMethod === 'online'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-amber-50 text-amber-700'
                              }`}>
                                {notif.paymentMethod === 'online' ? '💳 Escrow' : '🤝 Cash'}
                              </span>
                              <span className="text-[9px] text-gray-400 font-mono">
                                {new Date(notif.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                            <p className="text-xs font-bold text-gray-800 leading-snug">
                              {notif.customerName} {t('orderPlacedBy')} <span className="text-primary font-extrabold">{notif.offerName}</span>
                            </p>
                            <div className="text-[11px] font-mono font-bold text-gray-500 mt-1">
                              {t('amountLabel')} <span className="text-primary">{notif.totalPrice.toFixed(2)} MAD</span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {user ? (
              <div className="flex items-center gap-4">
                <Link 
                  to={user.role === 'admin' ? '/admin/dashboard' : user.role === 'consumer' ? '/dashboard' : '/restaurant-dashboard'}
                  className="flex items-center gap-2 text-sm font-bold text-gray-700 hover:text-primary transition-colors bg-gray-50 px-3 py-1.5 rounded-full border border-gray-100"
                >
                  <div className="w-6 h-6 bg-primary/20 rounded-full flex items-center justify-center">
                    <UserIcon className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <span>{t('myProfile')}</span>
                </Link>
                <button
                  onClick={() => setIsLogoutModalOpen(true)}
                  className="p-2 text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
                  title={t('logout')}
                >
                  <LogOut className="h-5 w-5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Link
                  to="/auth"
                  className="text-sm font-bold text-gray-700 hover:text-primary transition-colors px-4 py-2"
                >
                  {t('login')}
                </Link>
                <Link
                  to="/auth?tab=signup"
                  className="text-sm font-bold text-white bg-primary hover:bg-primary-hover transition-colors px-5 py-2.5 rounded-full shadow-md shadow-primary/20"
                >
                  {t('signup')}
                </Link>
              </div>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="flex items-center md:hidden gap-4">
            {/* Real-time Notification bell for Mobile partners */}
            {user && user.role === 'restaurant' && unreadCount > 0 && (
              <button
                onClick={() => {
                  navigate('/restaurant-dashboard');
                }}
                className="relative p-2 text-gray-600"
              >
                <Bell className="h-5 w-5 text-primary" />
                <span className="absolute top-0 right-0 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[8px] font-black text-white animate-pulse">
                  {unreadCount}
                </span>
              </button>
            )}

            {/* Quick Language switcher on Mobile */}
            <button
              onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}
              className="text-xs font-black border border-gray-200 px-2.5 py-1 rounded-full text-gray-700 hover:text-primary text-center"
            >
              {language === 'en' ? 'العربية 🇸🇦' : 'EN 🇬🇧'}
            </button>

            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="text-gray-600 hover:text-gray-900 focus:outline-none p-2"
            >
              {isMobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Nav Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden bg-white border-b border-gray-100 shadow-xl absolute w-full left-0 z-50">
          <div className="px-4 pt-2 pb-6 space-y-4 text-right">
            <Link 
              to="/meals" 
              onClick={() => setIsMobileMenuOpen(false)}
              className="block w-full px-4 py-3 text-base font-bold text-gray-700 hover:bg-gray-50 rounded-xl"
            >
              {t('meals')}
            </Link>
            {selectedCity && (
              <button 
                onClick={() => {
                  setSelectedCity('');
                  setIsMobileMenuOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 text-base font-bold text-gray-600 bg-gray-50 px-4 py-3 rounded-xl border border-gray-200"
              >
                <span className="text-xs text-gray-400">{t('filterByCity')}</span>
                <span className="flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-primary" />
                  {selectedCity === 'Casablanca' ? t('casablanca') : selectedCity === 'Mohammedia' ? t('mohammedia') : selectedCity}
                </span>
              </button>
            )}

            {user ? (
              <>
                <Link 
                  to={user.role === 'admin' ? '/admin/dashboard' : user.role === 'consumer' ? '/dashboard' : '/restaurant-dashboard'}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex items-center justify-between text-base font-bold text-gray-900 px-4 py-3 rounded-xl hover:bg-gray-50"
                >
                  <UserIcon className="h-5 w-5 text-primary" />
                  <span>{t('myProfile')} ({user.name})</span>
                </Link>
                <button
                  onClick={() => {
                    setIsLogoutModalOpen(true);
                    setIsMobileMenuOpen(false);
                  }}
                  className="flex w-full items-center justify-between text-base font-bold text-red-600 px-4 py-3 rounded-xl hover:bg-red-50"
                >
                  <LogOut className="h-5 w-5" />
                  <span>{t('logout')}</span>
                </button>
              </>
            ) : (
              <div className="flex flex-col gap-3 pt-2">
                <Link
                  to="/auth"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="w-full text-center text-base font-bold text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors px-4 py-3 rounded-xl"
                >
                  {t('login')}
                </Link>
                <Link
                  to="/auth?tab=signup"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="w-full text-center text-base font-bold text-white bg-primary hover:bg-primary-hover transition-colors px-4 py-3 rounded-xl"
                >
                  {t('signup')}
                </Link>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={isLogoutModalOpen}
        title={t('logoutConfirmTitle')}
        message={t('logoutConfirmMsg')}
        confirmText={t('confirm')}
        cancelText={t('cancel')}
        onConfirm={handleLogout}
        onCancel={() => setIsLogoutModalOpen(false)}
      />
    </nav>
  );
}
