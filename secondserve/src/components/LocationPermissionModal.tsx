import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MapPin, ShieldAlert, Crosshair, X, CheckCircle, Navigation, Info } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

interface LocationPermissionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGrant: () => void;
  role: 'consumer' | 'restaurant';
}

export function LocationPermissionModal({
  isOpen,
  onClose,
  onGrant,
  role
}: LocationPermissionModalProps) {
  const { t, language } = useAppContext();
  const isRTL = language === 'ar';
  const isSecure = typeof window !== 'undefined' && window.isSecureContext;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-md" dir={isRTL ? 'rtl' : 'ltr'}>
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 15 }}
            transition={{ type: 'spring', duration: 0.4 }}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden relative border border-gray-100 p-7"
            id="location-permission-modal"
          >
            {/* Close Button */}
            <button
              onClick={onClose}
              className="absolute top-5 right-5 text-gray-400 hover:text-gray-600 transition-all p-1.5 rounded-full hover:bg-gray-100"
              aria-label={t('locModalCloseAria')}
            >
              <X className="h-5 w-5" />
            </button>

            {/* Glowing Map Pin Header */}
            <div className="flex items-center gap-4 mb-6">
              <div className="relative flex-shrink-0">
                <div className="absolute inset-0 bg-primary/20 rounded-2xl animate-ping opacity-75"></div>
                <div className="relative w-14 h-14 bg-primary/10 text-primary rounded-2xl flex items-center justify-center border border-primary/20">
                  <Navigation className="h-7 w-7 rotate-45" />
                </div>
              </div>
              <div>
                <span className="text-xs font-bold text-primary uppercase tracking-wider px-2.5 py-1 bg-primary/10 rounded-full">
                  {t('gpsSafetySystem')}
                </span>
                <h3 className="text-xl font-display font-black text-gray-950 mt-1">
                  {t('enablePreciseLocation')}
                </h3>
              </div>
            </div>

            {/* Explanation why we need it based on user role */}
            <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100 mb-6 space-y-4">
              <div className="flex gap-2 text-slate-700 font-semibold text-sm items-center">
                <Info className="h-4 w-4 text-primary flex-shrink-0" />
                <span>{t('howWeUseLocation')}</span>
              </div>

              {role === 'consumer' ? (
                <ul className="space-y-3">
                  <li className="flex items-start gap-2.5 text-xs text-slate-600">
                    <CheckCircle className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong>{t('locModalConsumerB1Title')}</strong> {t('locModalConsumerB1Desc')}
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5 text-xs text-slate-600">
                    <CheckCircle className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong>{t('locModalConsumerB2Title')}</strong> {t('locModalConsumerB2Desc')}
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5 text-xs text-slate-600">
                    <CheckCircle className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong>{t('locModalConsumerB3Title')}</strong> {t('locModalConsumerB3Desc')}
                    </span>
                  </li>
                </ul>
              ) : (
                <ul className="space-y-3">
                  <li className="flex items-start gap-2.5 text-xs text-slate-600">
                    <CheckCircle className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong>{t('locModalPartnerB1Title')}</strong> {t('locModalPartnerB1Desc')}
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5 text-xs text-slate-600">
                    <CheckCircle className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong>{t('locModalPartnerB2Title')}</strong> {t('locModalPartnerB2Desc')}
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5 text-xs text-slate-600">
                    <CheckCircle className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                    <span>
                      <strong>{t('locModalPartnerB3Title')}</strong> {t('locModalPartnerB3Desc')}
                    </span>
                  </li>
                </ul>
              )}
            </div>

            {/* HTTPS warning / security info */}
            {!isSecure ? (
              <div className="flex items-start gap-3 p-4 bg-amber-50 rounded-2xl border border-amber-200 text-amber-900 mb-6 font-medium text-xs">
                <ShieldAlert className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5 animate-pulse" />
                <div className="space-y-1">
                  <p className="font-bold">{t('locModalInsecureTitle')}</p>
                  <p className="text-amber-700 opacity-90 leading-relaxed">
                    {t('locModalInsecureDesc')}
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-gray-400 mb-6 text-center">
                {t('locModalSecureNote')}
              </p>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-5 py-3 rounded-xl font-semibold bg-gray-100 hover:bg-gray-200 text-gray-800 transition-all text-xs"
              >
                {t('noThanksManual')}
              </button>
              <button
                type="button"
                onClick={onGrant}
                className="flex-1 px-5 py-3 rounded-xl font-bold bg-primary hover:bg-primary-hover text-white shadow-lg shadow-primary/20 hover:shadow-primary/30 transition-all flex items-center justify-center gap-2 text-xs cursor-pointer"
              >
                <Crosshair className="h-4 w-4" />
                {t('grantAutoDetect')}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
