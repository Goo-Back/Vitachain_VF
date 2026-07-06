import { ShieldCheck, ArrowUpRight } from 'lucide-react';
import { useAppContext } from '../context/AppContext';

// SecondServe administration has been centralised into the unified VitaChain
// admin console (/dashboard/admin/secondserve), backed by service-role
// endpoints. This notice points operators to the new home.
const VITACHAIN_ADMIN_URL =
  (import.meta.env.VITE_VITACHAIN_ADMIN_URL as string | undefined) ??
  'http://localhost:3000/dashboard/admin/secondserve';

export function AdminMoved() {
  const { language } = useAppContext();
  const isRTL = language === 'ar';

  return (
    <div
      className="min-h-[60vh] flex items-center justify-center px-4"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div className="max-w-lg w-full bg-white rounded-3xl border border-gray-100 shadow-sm p-8 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-900 text-white">
          <ShieldCheck className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-display font-black text-gray-900">
          {isRTL
            ? 'تم نقل لوحة الإدارة'
            : 'Administration centralised'}
        </h1>
        <p className="mt-2 text-sm font-semibold text-gray-500 leading-relaxed">
          {isRTL
            ? 'تُدار إدارة SecondServe الآن من وحدة تحكم VitaChain الموحّدة. سجّل الدخول بحساب مسؤول VitaChain.'
            : "SecondServe administration now lives in the unified VitaChain admin console. Sign in there with a VitaChain ADMIN account."}
        </p>
        <a
          href={VITACHAIN_ADMIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-black text-white hover:bg-primary-hover transition-all"
        >
          {isRTL ? 'فتح وحدة تحكم VitaChain' : 'Open VitaChain console'}
          <ArrowUpRight className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}
