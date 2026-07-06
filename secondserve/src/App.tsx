/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AppProvider } from './context/AppContext';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { CitySelector } from './components/CitySelector';

const Home = lazy(() => import('./pages/Home').then(m => ({ default: m.Home })));
const Auth = lazy(() => import('./pages/Auth').then(m => ({ default: m.Auth })));
const ConsumerDashboard = lazy(() => import('./pages/ConsumerDashboard').then(m => ({ default: m.ConsumerDashboard })));
const RestaurantDashboard = lazy(() => import('./pages/RestaurantDashboard').then(m => ({ default: m.RestaurantDashboard })));
const Meals = lazy(() => import('./pages/Meals').then(m => ({ default: m.Meals })));
// SecondServe admin is centralised in the VitaChain console; the in-app
// dashboard is retired and these routes now show a redirect notice.
const AdminMoved = lazy(() => import('./pages/AdminMoved').then(m => ({ default: m.AdminMoved })));
const OrderReceipt = lazy(() => import('./pages/OrderReceipt').then(m => ({ default: m.OrderReceipt })));
const Checkout = lazy(() => import('./pages/Checkout').then(m => ({ default: m.Checkout })));
const RestaurantOrderDetails = lazy(() => import('./pages/RestaurantOrderDetails').then(m => ({ default: m.RestaurantOrderDetails })));

export default function App() {
  return (
    <Router>
      <AppProvider>
        <div className="min-h-screen flex flex-col font-sans">
          <Navbar />
          <CitySelector />
          <main className="flex-grow">
            <Suspense fallback={<div className="flex items-center justify-center min-h-[50vh] text-gray-500">Loading…</div>}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/meals" element={<Meals />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/dashboard" element={<ConsumerDashboard />} />
                <Route path="/checkout/:offerId" element={<Checkout />} />
                <Route path="/orders/:id" element={<OrderReceipt />} />
                <Route path="/restaurant-dashboard" element={<RestaurantDashboard />} />
                <Route path="/restaurant/orders/:id" element={<RestaurantOrderDetails />} />
                <Route path="/admin-dashboard" element={<AdminMoved />} />
                <Route path="/admin/dashboard" element={<AdminMoved />} />
                <Route path="/admin" element={<AdminMoved />} />
              </Routes>
            </Suspense>
          </main>
          <Footer />
        </div>
        <Toaster position="bottom-right" richColors />
      </AppProvider>
    </Router>
  );
}


