import React, { useState, useEffect } from 'react';
import { MapPin, X } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { City } from '../types';
import { motion, AnimatePresence } from 'motion/react';

export function CitySelector() {
  const { selectedCity, setSelectedCity, t, language } = useAppContext();
  const isRTL = language === 'ar';
  const [isOpen, setIsOpen] = useState(false);

  // Open modal on first visit if no city is selected
  useEffect(() => {
    if (!selectedCity) {
      setIsOpen(true);
    }
  }, [selectedCity]);

  const handleSelect = (city: City) => {
    setSelectedCity(city);
    setIsOpen(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            dir={isRTL ? 'rtl' : 'ltr'}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl relative"
            >
              {selectedCity && (
                <button 
                  onClick={() => setIsOpen(false)}
                  className="absolute top-4 right-4 p-2 text-gray-400 hover:text-gray-900 rounded-full hover:bg-gray-100 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              )}
              
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <MapPin className="h-8 w-8 text-primary" />
              </div>
              
              <h2 className="text-2xl font-display font-bold text-center text-gray-900 mb-2">
                {t('citySelectorTitle')}
              </h2>
              <p className="text-center text-gray-500 mb-8">
                {t('citySelectorDesc')}
              </p>

              <div className="space-y-3">
                {(['Casablanca', 'Mohammedia'] as City[]).map((city) => (
                  <button
                    key={city}
                    onClick={() => handleSelect(city)}
                    className="w-full py-4 px-6 rounded-xl border-2 border-gray-100 hover:border-primary hover:bg-primary/5 transition-all flex items-center justify-between group"
                  >
                    <span className="font-medium text-gray-900 group-hover:text-primary transition-colors">
                      {city === 'Casablanca' ? t('casablanca') : t('mohammedia')}
                    </span>
                    <MapPin className="h-5 w-5 text-gray-400 group-hover:text-primary transition-colors" />
                  </button>
                ))}
              </div>

              <p className="text-center text-sm text-gray-400 mt-6">
                {t('citySelectorComingSoon')}
              </p>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
