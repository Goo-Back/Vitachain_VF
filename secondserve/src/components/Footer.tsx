import React from 'react';
import { Leaf, Instagram, Twitter, Facebook, Phone, MapPin, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { useAppContext } from '../context/AppContext';

export function Footer() {
  const { t, language } = useAppContext();
  const isRTL = language === 'ar';

  const handleEmailClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    try {
      navigator.clipboard.writeText('Servesecond2@gmail.com');
      toast.success(t('footerEmailCopiedToast'), { duration: 4000 });
    } catch (err) {
      console.error('Failed to copy email', err);
    }
  };

  return (
    <footer className="bg-slate-900 border-t border-slate-800 shadow-inner pt-16 pb-8 text-gray-300" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
          <div className="col-span-1 md:col-span-2">
            <Link to="/" className="flex items-center gap-2 mb-4">
              <img src="/logo.png" alt="SecondeServe Logo" className="h-10 w-auto object-contain brightness-0 invert" />
            </Link>
            <p className="text-gray-400 max-w-sm mb-6">
              {t('footerTagline')}
            </p>
            <div className="flex space-x-4">
              <a 
                href="https://www.instagram.com/second.serve2?igsh=dnp6dHlreHd4cWto" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-gray-400 hover:text-white transition-colors"
                title="Instagram"
              >
                <Instagram className="h-5 w-5" />
              </a>
              <a 
                href="https://wa.me/212725659764" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-gray-400 hover:text-white transition-colors"
                title="WhatsApp"
              >
                <Phone className="h-5 w-5" />
              </a>
              <a 
                href="mailto:Servesecond2@gmail.com" 
                className="text-gray-400 hover:text-white transition-colors"
                title="Gmail"
              >
                <Mail className="h-5 w-5" />
              </a>
            </div>
          </div>
          
          <div>
            <h3 className="font-display font-semibold text-white mb-4">{t('footerQuickLinks')}</h3>
            <ul className="space-y-3">
              <li><Link to="/meals" className="text-gray-400 hover:text-white transition-colors">{t('footerTodaysOffers')}</Link></li>
              <li><Link to="/" className="text-gray-400 hover:text-white transition-colors">{t('footerHowItWorks')}</Link></li>
              <li><Link to="/auth?type=business" className="text-gray-400 hover:text-white transition-colors">{t('footerBecomePartner')}</Link></li>
              <li><Link to="/meals" className="text-gray-400 hover:text-white transition-colors">{t('footerExplorePartners')}</Link></li>
            </ul>
          </div>

          <div>
            <h3 className="font-display font-semibold text-white mb-4">{t('footerContact')}</h3>
            <ul className="space-y-3">
              <li>
                <a 
                  href="mailto:Servesecond2@gmail.com" 
                  onClick={handleEmailClick}
                  className="text-gray-400 hover:text-white transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <Mail className="h-4 w-4" />
                  Servesecond2@gmail.com
                </a>
              </li>
              <li>
                <a 
                  href="https://www.instagram.com/second.serve2?igsh=dnp6dHlreHd4cWto" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-gray-400 hover:text-white transition-colors flex items-center gap-2"
                >
                  <Instagram className="h-4 w-4" />
                  @second.serve2
                </a>
              </li>
              <li>
                <a 
                  href="https://wa.me/212725659764" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-gray-400 hover:text-white transition-colors flex items-center gap-2"
                >
                  <Phone className="h-4 w-4" />
                  +212 725-659764
                </a>
              </li>
              <li className="text-gray-400 flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                {t('footerLocationMorocco')}
              </li>
            </ul>
          </div>
        </div>
        
        <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row justify-between items-center">
          <p className="text-gray-500 text-sm mb-4 md:mb-0">
            &copy; {new Date().getFullYear()} SecondServe. {t('footerCopyright')}
          </p>
          <div className="flex space-x-6 text-sm">
            <button
              onClick={() => toast.info(t('footerPrivacyToast'))}
              className="text-gray-500 hover:text-white transition-colors cursor-pointer bg-transparent border-0 font-sans text-sm outline-none"
            >
              {t('footerPrivacyPolicy')}
            </button>
            <button
              onClick={() => toast.info(t('footerTermsToast'))}
              className="text-gray-500 hover:text-white transition-colors cursor-pointer bg-transparent border-0 font-sans text-sm outline-none"
            >
              {t('footerTerms')}
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
