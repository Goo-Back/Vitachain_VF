import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Mail, Lock, User as UserIcon, Store, MapPin, Phone, ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { UserRole, CommerceType, City, User } from '../types';
import { toast } from 'sonner';
import { supabase, rowToUser, ensureSsProfile, SsFarmerBlockedError } from '../lib/supabase';

export function Auth() {
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') === 'signup' || searchParams.get('type') === 'business' ? 'signup' : 'login';
  const initialRole = searchParams.get('type') === 'business' ? 'restaurant' : 'consumer';

  const [isLogin, setIsLogin] = useState(initialTab === 'login');
  const [role, setRole] = useState<UserRole>(initialRole);
  const [showSecretCode, setShowSecretCode] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { setUser, setSelectedCity, t, language } = useAppContext();
  const navigate = useNavigate();
  const isRTL = language === 'ar';

  const redirectUser = (userRole: UserRole) => {
    if (userRole === 'admin') navigate('/admin/dashboard');
    else if (userRole === 'restaurant') navigate('/restaurant-dashboard');
    else navigate('/dashboard');
  };

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isLoading) return;
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = (formData.get('email') as string).trim().toLowerCase();
    const password = formData.get('password') as string;

    try {
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError || !signInData.user) {
        const msg = (signInError?.message || '').toLowerCase();
        if (msg.includes('invalid') || msg.includes('credentials')) {
          toast.error(t('authErrInvalidCreds'));
        } else if (msg.includes('confirm')) {
          toast.error(t('authErrLoginGeneric') + ': email not confirmed');
        } else {
          toast.error(t('authErrLoginGeneric') + ': ' + (signInError?.message || ''));
        }
        return;
      }

      const userId = signInData.user.id;
      // Resolve (or provision) the SecondServe profile. Farmer accounts from the
      // shared VitaChain pool are rejected.
      let profile: User;
      try {
        profile = await ensureSsProfile(userId, email);
      } catch (err) {
        if (err instanceof SsFarmerBlockedError) {
          await supabase.auth.signOut();
          toast.error(t('authErrFarmerBlocked'));
          return;
        }
        throw err;
      }

      if (profile.banned) {
        await supabase.auth.signOut();
        toast.error(t('authToastSuspended'));
        return;
      }

      setUser(profile);
      setSelectedCity(profile.city || 'Casablanca');
      toast.success(`${t('authToastWelcomeBack')}, ${profile.name}!`);
      redirectUser(profile.role);
    } catch (error: any) {
      console.error('Login error:', error);
      toast.error(t('authErrLoginGeneric') + ': ' + (error?.message || ''));
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isLoading) return;

    const formData = new FormData(e.currentTarget);
    const name = (formData.get('name') as string).trim();
    const email = (formData.get('email') as string).trim().toLowerCase();
    const city = formData.get('city') as City;
    const commerceType = formData.get('commerceType') as CommerceType;
    const address = (formData.get('address') as string)?.trim() || '';
    const phone = (formData.get('phone') as string)?.trim() || '0600000000';
    const secretCode = formData.get('secretCode') as string;
    const password = formData.get('password') as string;

    // Validations
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error(t('authErrEmailInvalid'));
      return;
    }

    if (password.length < 8 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      toast.error(t('authErrPasswordWeak'));
      return;
    }

    if (role === 'restaurant') {
      if (secretCode !== 'welcometoSecondServe2026') {
        toast.error(t('authErrSecretInvalid'));
        return;
      }
      const validTypes = ['Patisserie', 'Superette', 'Buffet à volonté'];
      if (!validTypes.includes(commerceType)) {
        toast.error(t('authErrBusinessTypeInvalid'));
        return;
      }
    }

    setIsLoading(true);

    try {
      // SecondServe-specific metadata; the handle_new_ss_user() DB trigger
      // reads these to materialise the ss_profiles row atomically with signup.
      const ssMeta: Record<string, string> = {
        ss_app: 'secondserve',
        ss_role: role,
        ss_name: name,
        ss_city: city || 'Casablanca',
        // Whatever language the signup form is currently shown in becomes the
        // account's language everywhere, on every device (handle_new_ss_user
        // persists this to ss_profiles.locale).
        ss_locale: language,
      };
      if (role === 'restaurant') {
        ssMeta.ss_commerce_type = commerceType || 'Patisserie';
        ssMeta.ss_address = address || 'New Address';
        ssMeta.ss_phone = phone || '0600000000';
        ssMeta.ss_lat = '33.5731';
        ssMeta.ss_lng = '-7.5898';
        ssMeta.ss_map_link = 'https://www.google.com/maps?q=33.5731,-7.5898';
      }

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: ssMeta },
      });

      if (signUpError) {
        const msg = (signUpError.message || '').toLowerCase();
        if (msg.includes('already') || msg.includes('registered')) {
          toast.error(t('authErrEmailInUse'));
          setIsLogin(true);
        } else if (msg.includes('password')) {
          toast.error(t('authErrWeakPassword'));
        } else {
          toast.error(t('authErrSignupGeneric') + ': ' + signUpError.message);
        }
        return;
      }

      setSelectedCity(city || 'Casablanca');

      // The handle_new_ss_user trigger auto-confirms the email, but signUp still
      // returns without a session (the project requires confirmation globally).
      // So sign in immediately to obtain the session — Firebase-like instant UX.
      let session = signUpData.session;
      if (!session) {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError || !signInData.session) {
          // Fallback: confirmation could not be auto-applied; ask to log in.
          toast.info(t('authToastConsumerCreated'));
          setIsLogin(true);
          return;
        }
        session = signInData.session;
      }

      // Session is live → read the trigger-created profile and continue.
      const userId = session.user.id;
      const { data: row } = await supabase
        .from('ss_profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();
      if (row) setUser(rowToUser(row));

      if (role === 'restaurant') {
        toast.info(t('authToastPartnerPending'));
      } else {
        toast.success(t('authToastConsumerCreated'));
      }
      redirectUser(role);
    } catch (error: any) {
      console.error('Signup error:', error);
      toast.error(t('authErrSignupGeneric') + ': ' + (error?.message || ''));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-80px)] bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center mb-6">
          <img src="/logo.png" alt="SecondServe Logo" className="h-16 w-auto object-contain" />
        </div>
        <h2 className="text-center text-3xl font-display font-bold tracking-tight text-gray-900">
          {isLogin ? t('authWelcomeBack') : t('authJoinUs')}
        </h2>
        <p className="mt-2 text-center text-sm text-gray-600">
          {isLogin ? t('authLoginSub') : t('authSignupSub')}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-xl shadow-gray-200/50 sm:rounded-3xl sm:px-10 border border-gray-100">

          {/* Tabs */}
          <div className="flex p-1 bg-gray-100 rounded-xl mb-8">
            <button
              onClick={() => setIsLogin(true)}
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${isLogin ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t('authTabLogin')}
            </button>
            <button
              onClick={() => setIsLogin(false)}
              className={`flex-1 py-2.5 text-sm font-medium rounded-lg transition-all ${!isLogin ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {t('authTabSignup')}
            </button>
          </div>

          {/* Role Selection */}
          {!isLogin && (
            <div className="grid grid-cols-2 gap-4 mb-8">
              <button
                onClick={() => setRole('consumer')}
                className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all ${role === 'consumer' ? 'border-primary bg-primary/5 text-primary' : 'border-gray-100 bg-white text-gray-500 hover:border-gray-200'}`}
              >
                <UserIcon className="h-6 w-6 mb-2" />
                <span className="text-sm font-semibold">{t('authRoleConsumer')}</span>
              </button>
              <button
                onClick={() => setRole('restaurant')}
                className={`flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all ${role === 'restaurant' ? 'border-primary bg-primary/5 text-primary' : 'border-gray-100 bg-white text-gray-500 hover:border-gray-200'}`}
              >
                <Store className="h-6 w-6 mb-2" />
                <span className="text-sm font-semibold">{t('authRoleBusiness')}</span>
              </button>
            </div>
          )}

          {/* Form */}
          <form className="space-y-5" onSubmit={isLogin ? handleLogin : handleSignup}>
            {!isLogin && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {role === 'consumer' ? t('authFullName') : t('authBusinessName')}
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      {role === 'consumer' ? <UserIcon className="h-5 w-5 text-gray-400" /> : <Store className="h-5 w-5 text-gray-400" />}
                    </div>
                    <input
                      name="name"
                      required
                      type="text"
                      className="block w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all bg-gray-50 focus:bg-white"
                      placeholder={role === 'consumer' ? t('authFullNamePh') : t('authBusinessNamePh')}
                    />
                  </div>
                </div>

                {role === 'restaurant' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('authBusinessType')}</label>
                    <select
                      name="commerceType"
                      required
                      className="block w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all bg-gray-50 focus:bg-white"
                    >
                      <option value="Patisserie">Patisserie</option>
                      <option value="Superette">Superette</option>
                      <option value="Buffet à volonté">Buffet à volonté</option>
                    </select>
                  </div>
                )}
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('authEmailLabel')}</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  name="email"
                  required
                  type="email"
                  className="block w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all bg-gray-50 focus:bg-white"
                  placeholder={t('authEmailPh')}
                />
              </div>
            </div>

            {!isLogin && role === 'restaurant' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('authPhoneLabel')}</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Phone className="h-5 w-5 text-gray-400" />
                  </div>
                  <input
                    name="phone"
                    required
                    type="tel"
                    className="block w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all bg-gray-50 focus:bg-white"
                    placeholder={t('authPhonePh')}
                  />
                </div>
              </div>
            )}

            {!isLogin && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('authCityLabel')}</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <MapPin className="h-5 w-5 text-gray-400" />
                  </div>
                  <select
                    name="city"
                    required
                    className="block w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all bg-gray-50 focus:bg-white"
                  >
                    <option value="Casablanca">{t('casablanca')}</option>
                    <option value="Mohammedia">{t('mohammedia')}</option>
                  </select>
                </div>
              </div>
            )}

            {!isLogin && role === 'restaurant' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('authSecretCode')}</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                      <Lock className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      name="secretCode"
                      required
                      type={showSecretCode ? 'text' : 'password'}
                      className="block w-full pl-11 pr-12 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all bg-gray-50 focus:bg-white"
                      placeholder={t('authSecretCodePh')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecretCode(!showSecretCode)}
                      className="absolute inset-y-0 right-0 pr-4 flex items-center text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      {showSecretCode ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('authFullAddress')}</label>
                  <textarea
                    name="address"
                    required
                    rows={2}
                    className="block w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all bg-gray-50 focus:bg-white"
                    placeholder={t('authFullAddressPh')}
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('authPasswordLabel')}</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <input
                  name="password"
                  required
                  type="password"
                  className="block w-full pl-11 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none transition-all bg-gray-50 focus:bg-white"
                  placeholder="••••••••"
                />
              </div>
            </div>

            {isLogin && (
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <input
                    id="remember-me"
                    name="remember-me"
                    type="checkbox"
                    className="h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded"
                  />
                  <label htmlFor="remember-me" className="ml-2 block text-sm text-gray-900">
                    {t('authRememberMe')}
                  </label>
                </div>
              </div>
            )}

            <div>
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-center items-center gap-2 py-3.5 px-4 border border-transparent rounded-xl shadow-sm text-sm font-bold text-white bg-gray-900 hover:bg-primary transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{isLogin ? t('authSigningIn') : t('authRegistering')}</span>
                  </>
                ) : (
                  <>
                    <span>{isLogin ? t('authLoginBtn') : t('authSignupBtn')}</span>
                    <ArrowRight className={`h-4 w-4 ${isRTL ? 'rotate-180' : ''}`} />
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
