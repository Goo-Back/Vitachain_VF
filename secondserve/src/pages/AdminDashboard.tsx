import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { User, SupportTicket, Order } from '../types';
import { 
  Users, Store, ShoppingBag, BarChart3, HelpCircle, Ban, CheckCircle2, 
  XCircle, Trash2, MessageSquare, RefreshCcw, DollarSign, Award, ArrowUpRight, 
  ChevronRight, Lock, Clock, AlertCircle, FileText, Send 
} from 'lucide-react';
import { motion } from 'motion/react';
import { toast } from 'sonner';

export function AdminDashboard() {
  const navigate = useNavigate();
  const {
    user,
    users,
    banUser,
    unbanUser,
    deleteUser,
    approvePartner,
    rejectPartner,
    supportTickets,
    resolveSupportTicket,
    orders,
    offers,
    cancelOrder,
    language
  } = useAppContext();

  const isRTL = language === 'ar';

  // Secure guard redirect logic
  useEffect(() => {
    if (!user || user.role !== 'admin') {
      toast.error(isRTL ? 'الوصول مرفوض' : 'Access Denied: Only Administrator accounts can view this terminal.');
      navigate('/auth?tab=login');
    }
  }, [user, navigate, isRTL]);

  if (!user || user.role !== 'admin') {
    return null;
  }

  // State
  const [activeTab, setActiveTab ] = useState<'users' | 'partners' | 'orders' | 'stats' | 'support'>('users');
  const [replyText, setReplyText] = useState<{ [ticketId: string]: string }>({});
  const [banSearchQuery, setBanSearchQuery] = useState('');
  const [orderFilter, setOrderFilter] = useState<'all' | 'active' | 'completed' | 'cancelled'>('all');
  const [orderSearch, setOrderSearch] = useState('');
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Analytics helper variables
  const analytics = useMemo(() => {
    const totalUsers = users.length;
    const totalPartners = users.filter(u => u.role === 'restaurant').length;
    const totalOrders = orders.length;
    
    // Revenue calculator (sum of completed orders or any successful transaction)
    const revenue = orders
      .filter(o => o.status === 'completed' || o.paymentStatus === 'successful')
      .reduce((sum, o) => sum + Number(o.totalPrice), 0);

    // Group orders to find the most popular product
    const productFrequency: { [key: string]: { name: string, count: number, revenue: number, image: string } } = {};
    orders.forEach(ord => {
      const snap = ord.offerSnapshot;
      if (!snap) return;
      if (!productFrequency[snap.id]) {
        productFrequency[snap.id] = { 
          name: snap.name, 
          count: 0, 
          revenue: 0,
          image: snap.image || 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=150&q=80'
        };
      }
      productFrequency[snap.id].count += ord.quantity;
      productFrequency[snap.id].revenue += ord.totalPrice;
    });

    const popularProducts = Object.values(productFrequency)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Order pipeline breakdown (pickup model: active / completed / cancelled).
    const completedOrders = orders.filter(o => o.status === 'completed').length;
    const cancelledOrders = orders.filter(o => o.status === 'cancelled').length;
    const activeOrders = orders.filter(o => o.status === 'active').length;
    const cancellationRate = totalOrders > 0 ? cancelledOrders / totalOrders : 0;
    const mealsRescued = orders
      .filter(o => o.status !== 'cancelled')
      .reduce((sum, o) => sum + o.quantity, 0);

    return {
      totalUsers,
      totalPartners,
      totalOrders,
      revenue,
      popularProducts,
      completedOrders,
      cancelledOrders,
      activeOrders,
      cancellationRate,
      mealsRescued
    };
  }, [users, orders]);

  // Restaurant name lookup for the orders table.
  const restaurantNameById = useMemo(() => {
    const map: Record<string, string> = {};
    users.forEach(u => { if (u.role === 'restaurant') map[u.id] = u.name; });
    return map;
  }, [users]);

  // Filtered + searched order list for the admin Orders tab.
  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return orders
      .filter(o => orderFilter === 'all' ? true : o.status === orderFilter)
      .filter(o => {
        if (!q) return true;
        return (
          (o.consumerName || '').toLowerCase().includes(q) ||
          (o.consumerPhone || '').toLowerCase().includes(q) ||
          (o.offerSnapshot?.name || '').toLowerCase().includes(q) ||
          o.id.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [orders, orderFilter, orderSearch]);

  const handleAdminCancel = async (orderId: string) => {
    if (!window.confirm(isRTL ? 'إلغاء هذا الطلب نهائياً؟' : 'Cancel this order permanently?')) return;
    setCancellingId(orderId);
    try {
      await cancelOrder(orderId);
    } finally {
      setCancellingId(null);
    }
  };

  // Handle Response submit
  const submitReply = (ticketId: string) => {
    const response = replyText[ticketId]?.trim();
    if (!response) {
      toast.error(isRTL ? 'الرجاء كتابة رسالة رد صالحة' : 'Please input a valid response message');
      return;
    }
    resolveSupportTicket(ticketId, response);
    toast.success(isRTL ? 'تم إرسال الرد وحل التذكرة!' : 'Ticket responded and marked as resolved!');
    setReplyText(prev => ({ ...prev, [ticketId]: '' }));
  };

  // Lists filtered by search query
  const filteredUsers = useMemo(() => {
    return users.filter(u => 
      u.email.toLowerCase().includes(banSearchQuery.toLowerCase()) || 
      u.name.toLowerCase().includes(banSearchQuery.toLowerCase())
    );
  }, [users, banSearchQuery]);

  return (
    <div className="min-h-screen bg-gray-50 py-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Header Ribbon */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 mb-8 bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
          <div className="text-right md:text-left flex items-center gap-4">
            <div className="p-3.5 bg-gray-900 text-white rounded-2xl">
              <BarChart3 className="h-7 w-7" />
            </div>
            <div>
              <h1 className="text-2xl font-display font-black text-gray-900 leading-normal">
                {isRTL ? 'اللوحة السيادية للمشرف العام' : 'Sovereign Administrator Terminal'}
              </h1>
              <p className="text-xs font-semibold text-gray-500 mt-0.5">
                {isRTL ? 'إدارة الأعضاء والشركاء والمراجعات ودعم العملاء فورياً.' : 'Execute high-level account status, validations, global listings, and resolve tickets.'}
              </p>
            </div>
          </div>
          <div className="bg-primary/10 text-primary rounded-full px-4 py-2 text-xs font-black">
            {isRTL ? 'صلاحية كاملة مفعّلة' : 'Super-Admin System Verified'}
          </div>
        </div>

        {/* Global Stats Banner */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          
          <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs font-bold text-gray-400 block uppercase tracking-wider">{isRTL ? 'إجمالي الأعضاء' : 'Total Members'}</span>
              <span className="text-3xl font-display font-black text-gray-900">{analytics.totalUsers}</span>
            </div>
            <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
              <Users className="h-6 w-6" />
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs font-bold text-gray-400 block uppercase tracking-wider">{isRTL ? 'شركاء الخدمات' : 'Authorized Partners'}</span>
              <span className="text-3xl font-display font-black text-gray-900">{analytics.totalPartners}</span>
            </div>
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
              <Store className="h-6 w-6" />
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs font-bold text-gray-400 block uppercase tracking-wider">{isRTL ? 'طلبات منقذة' : 'Meals Recycled'}</span>
              <span className="text-3xl font-display font-black text-gray-900">{analytics.totalOrders}</span>
            </div>
            <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl">
              <ShoppingBag className="h-6 w-6" />
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between">
            <div className="space-y-1">
              <span className="text-xs font-bold text-gray-400 block uppercase tracking-wider">{isRTL ? 'حجم المبيعات' : 'Secured Escrow'}</span>
              <span className="text-2xl font-mono font-black text-primary block">{analytics.revenue.toFixed(2)} MAD</span>
            </div>
            <div className="p-3 bg-primary/10 text-primary rounded-2xl">
              <DollarSign className="h-6 w-6" />
            </div>
          </div>

        </div>

        {/* Tab Switcher Panel */}
        <div className="bg-white p-2 rounded-2xl shadow-sm border border-gray-100 flex flex-wrap gap-2 mb-8">
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2 px-5 py-3.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'users' 
                ? 'bg-gray-900 text-white shadow-md shadow-gray-900/10' 
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <Users className="h-4.5 w-4.5" />
            <span>{isRTL ? 'إدارة الحسابات والمستخدمين' : 'Accounts Management'}</span>
          </button>

          <button
            onClick={() => setActiveTab('partners')}
            className={`flex items-center gap-2 px-5 py-3.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'partners' 
                ? 'bg-gray-900 text-white shadow-md shadow-gray-900/10' 
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <Store className="h-4.5 w-4.5" />
            <span>{isRTL ? 'اعتماد الشركاء والتحقق' : 'Partner Approvals'}</span>
          </button>

          <button
            onClick={() => setActiveTab('orders')}
            className={`flex items-center gap-2 px-5 py-3.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'orders'
                ? 'bg-gray-900 text-white shadow-md shadow-gray-900/10'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <ShoppingBag className="h-4.5 w-4.5" />
            <span>
              {isRTL ? 'إدارة الطلبات' : 'Orders Management'}
              {analytics.activeOrders > 0 && (
                <span className="ms-1.5 px-2 py-0.5 bg-amber-500 text-white text-[9px] rounded-full">
                  {analytics.activeOrders}
                </span>
              )}
            </span>
          </button>

          <button
            onClick={() => setActiveTab('stats')}
            className={`flex items-center gap-2 px-5 py-3.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'stats'
                ? 'bg-gray-900 text-white shadow-md shadow-gray-900/10'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <BarChart3 className="h-4.5 w-4.5" />
            <span>{isRTL ? 'إحصائيات المبيعات والأداء' : 'Analytics & Reports'}</span>
          </button>

          <button
            onClick={() => setActiveTab('support')}
            className={`flex items-center gap-2 px-5 py-3.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              activeTab === 'support' 
                ? 'bg-gray-900 text-white shadow-md shadow-gray-900/10' 
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            <HelpCircle className="h-4.5 w-4.5" />
            <span>
              {isRTL ? 'تذاكر الدعم المفتوحة' : 'Support Ticket Inbox'}
              {supportTickets.filter(t => t.status === 'pending').length > 0 && (
                <span className="ms-1.5 px-2 py-0.5 bg-red-500 text-white text-[9px] rounded-full">
                  {supportTickets.filter(t => t.status === 'pending').length}
                </span>
              )}
            </span>
          </button>
        </div>

        {/* Tab Panes */}
        <div className="space-y-6">

          {/* TAB 1: USERS */}
          {activeTab === 'users' && (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-6">
                <div>
                  <h3 className="text-lg font-black text-gray-900">{isRTL ? 'قائمة الأعضاء المسجلين' : 'Registered Marketplace Users'}</h3>
                  <p className="text-xs font-semibold text-gray-500">{isRTL ? 'عرض وحظر وحذف حسابات المستهلكين والمحلات بشكل فوري.' : 'Review, ban, unban, or permanently remove consumer/partner accounts.'}</p>
                </div>
                <input
                  type="text"
                  placeholder={isRTL ? 'ابحث بالبريد الإلكتروني أو الاسم...' : 'Scan email or full name...'}
                  value={banSearchQuery}
                  onChange={(e) => setBanSearchQuery(e.target.value)}
                  className="w-full sm:max-w-xs px-4 py-2.5 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-primary text-xs font-semibold"
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-gray-500" dir={isRTL ? 'rtl' : 'ltr'}>
                  <thead className="bg-gray-50 text-gray-700 font-extrabold text-[11px] uppercase border-b border-gray-100">
                    <tr>
                      <th className="px-6 py-4">{isRTL ? 'الاسم' : 'User/Business'}</th>
                      <th className="px-6 py-4">{isRTL ? 'البريد الإلكتروني' : 'Security Email'}</th>
                      <th className="px-6 py-4">{isRTL ? 'المدينة' : 'City'}</th>
                      <th className="px-6 py-4">{isRTL ? 'الدور' : 'Role'}</th>
                      <th className="px-6 py-4">{isRTL ? 'الحالة السيادية' : 'Account Status'}</th>
                      <th className="px-6 py-4 text-center">{isRTL ? 'الإجراءات' : 'Administrative Actions'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 font-black text-gray-900">{u.name}</td>
                        <td className="px-6 py-4 font-mono font-semibold">{u.email}</td>
                        <td className="px-6 py-4 font-semibold">{u.city || 'Casablanca'}</td>
                        <td className="px-6 py-4">
                          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                            u.role === 'admin' 
                              ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' 
                              : u.role === 'restaurant'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                              : 'bg-amber-50 text-amber-700 border border-amber-100'
                          }`}>
                            {u.role.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {u.banned ? (
                            <span className="inline-flex items-center gap-1.5 text-red-650 font-bold">
                              <Ban className="h-3.5 w-3.5" />
                              {isRTL ? 'محظور من الدخول' : 'Banned / Suspended'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-emerald-600 font-bold">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {isRTL ? 'نشط وآمن' : 'Active Safe'}
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex justify-center gap-2">
                            {u.role !== 'admin' && (
                              <>
                                {u.banned ? (
                                  <button
                                    onClick={() => {
                                      unbanUser(u.id);
                                      toast.success(isRTL ? 'تم إلغاء الحظر' : 'Account access reinstated.');
                                    }}
                                    className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl px-3 py-1.5 font-bold transition-colors cursor-pointer"
                                  >
                                    {isRTL ? 'إلغاء حظر الحساب' : 'Unban'}
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => {
                                      banUser(u.id);
                                      toast.error(isRTL ? 'تم حظر البريد الإلكتروني' : 'Account suspension executed.');
                                    }}
                                    className="bg-red-50 hover:bg-red-100 text-red-650 rounded-xl px-3 py-1.5 font-bold transition-colors cursor-pointer"
                                  >
                                    {isRTL ? 'حظر دخول' : 'Ban'}
                                  </button>
                                )}
                                <button
                                  onClick={() => {
                                    if (window.confirm(isRTL ? 'هل أنت متأكد من رغبتك في حذف هذا الحساب نهائياً؟ لا يمكن التراجع عن هذا الإجراء.' : 'Are you absolutely sure you want to permanently delete this user directory account record?')) {
                                      deleteUser(u.id);
                                    }
                                  }}
                                  className="bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl p-2 font-bold transition-colors cursor-pointer"
                                  title={isRTL ? 'حذف الحساب للأبد' : 'Destroy record'}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 2: PARTNER APPROVALS */}
          {activeTab === 'partners' && (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
              <div className="mb-6">
                <h3 className="text-lg font-black text-gray-900">{isRTL ? 'التحقق من شركاء المطاعم والحلويات' : 'Partner Registration Approvals'}</h3>
                <p className="text-xs font-semibold text-gray-500 leading-relaxed">
                  {isRTL 
                    ? 'في بيئة الدار البيضاء والمحمدية، يجب التحقق من هوية وجود مالك المخبزة قبل ظهور عروضه للجمهور.' 
                    : 'Unverified restaurants registration do not appear globally on the platform. Review and toggle status in real-time.'}
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* Pending partners list */}
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-gray-400 block uppercase tracking-wider">{isRTL ? 'طلبات تسجيل معلقة' : 'Pending Registrations'}</h4>
                  
                  {users.filter(u => u.role === 'restaurant' && u.approved === false).length === 0 ? (
                    <div className="border border-dashed border-gray-200 rounded-2xl p-6 text-center text-xs font-bold text-gray-400">
                      {isRTL ? 'لا توجد طلبات معلقة بانتظار التحقق 🎉' : 'Zero pending partner validations. Everything cleared.'}
                    </div>
                  ) : (
                    users.filter(u => u.role === 'restaurant' && u.approved === false).map(part => (
                      <div key={part.id} className="border border-amber-100 bg-amber-50/20 p-5 rounded-2xl flex flex-col justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex justify-between items-start">
                            <span className="font-black text-sm text-gray-900">{part.name}</span>
                            <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-[9px] font-black">{part.commerceType}</span>
                          </div>
                          <p className="text-xs text-gray-500 font-mono">{part.email}</p>
                          <p className="text-xs text-gray-600 font-semibold">{part.address}</p>
                          <p className="text-xs font-bold text-gray-700">{part.phone || '0600000000'}</p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => approvePartner(part.id)}
                            className="bg-primary text-white border-primary border hover:bg-primary-hover px-4 py-2 rounded-xl text-xs font-black transition-all cursor-pointer flex-1"
                          >
                            {isRTL ? 'موافقة واعتماد' : 'Approve & Validate'}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Approved status overview */}
                <div className="space-y-4 border-t md:border-t-0 md:border-s border-gray-100 md:ps-6">
                  <h4 className="text-xs font-bold text-gray-400 block uppercase tracking-wider">{isRTL ? 'شركاء معتمدون حالياً' : 'Approved Partners'}</h4>
                  
                  {users.filter(u => u.role === 'restaurant' && u.approved !== false).length === 0 ? (
                    <div className="border border-dashed border-gray-200 rounded-2xl p-6 text-center text-xs text-gray-400 font-bold">
                      {isRTL ? 'لا يوجد شركاء معتمدون حالياً.' : 'No active verified partners configured.'}
                    </div>
                  ) : (
                    users.filter(u => u.role === 'restaurant' && u.approved !== false).map(part => (
                      <div key={part.id} className="border border-gray-100 p-4 rounded-2xl flex items-center justify-between gap-4">
                        <div className="space-y-1.5 flex-grow">
                          <div className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            <span className="font-bold text-xs text-gray-900 leading-none">{part.name}</span>
                          </div>
                          <p className="text-[11px] text-gray-500 font-mono leading-none">{part.email}</p>
                          <p className="text-[11.5px] text-gray-600 leading-snug">{part.address}</p>
                        </div>
                        <button
                          onClick={() => {
                            rejectPartner(part.id);
                            toast.warning(isRTL ? 'تم تعليق الشريك بنجاح.' : 'Partner un-approved.');
                          }}
                          className="bg-stone-50 hover:bg-stone-100 border border-stone-200 text-stone-600 px-3 py-2 rounded-xl text-xs font-bold cursor-pointer"
                        >
                          {isRTL ? 'تعليق' : 'Suspend'}
                        </button>
                      </div>
                    ))
                  )}
                </div>

              </div>
            </div>
          )}

          {/* TAB: ORDERS MANAGEMENT */}
          {activeTab === 'orders' && (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
              <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 mb-6">
                <div>
                  <h3 className="text-lg font-black text-gray-900">{isRTL ? 'سجل الطلبات الشامل' : 'Global Orders Ledger'}</h3>
                  <p className="text-xs font-semibold text-gray-500">{isRTL ? 'تتبع جميع الطلبات عبر المنصة، تحقق من الدفع، وألغِ عند الضرورة.' : 'Track every order across the platform, inspect payment, and cancel when needed.'}</p>
                </div>
                <input
                  type="text"
                  placeholder={isRTL ? 'بحث بالاسم، الهاتف، الوجبة...' : 'Search name, phone, meal, ref...'}
                  value={orderSearch}
                  onChange={(e) => setOrderSearch(e.target.value)}
                  className="w-full lg:max-w-xs px-4 py-2.5 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-primary text-xs font-semibold"
                />
              </div>

              {/* Filter chips */}
              <div className="flex flex-wrap gap-2 mb-5">
                {([
                  { v: 'all', l: isRTL ? 'الكل' : 'All', n: analytics.totalOrders },
                  { v: 'active', l: isRTL ? 'قيد التنفيذ' : 'Active', n: analytics.activeOrders },
                  { v: 'completed', l: isRTL ? 'مكتملة' : 'Completed', n: analytics.completedOrders },
                  { v: 'cancelled', l: isRTL ? 'ملغاة' : 'Cancelled', n: analytics.cancelledOrders },
                ] as const).map(f => (
                  <button
                    key={f.v}
                    onClick={() => setOrderFilter(f.v)}
                    className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold transition-colors cursor-pointer ${
                      orderFilter === f.v ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {f.l} ({f.n})
                  </button>
                ))}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-gray-500" dir={isRTL ? 'rtl' : 'ltr'}>
                  <thead className="bg-gray-50 text-gray-700 font-extrabold text-[11px] uppercase border-b border-gray-100">
                    <tr>
                      <th className="px-4 py-4">{isRTL ? 'المرجع / التاريخ' : 'Ref / Date'}</th>
                      <th className="px-4 py-4">{isRTL ? 'العميل' : 'Customer'}</th>
                      <th className="px-4 py-4">{isRTL ? 'المتجر' : 'Partner'}</th>
                      <th className="px-4 py-4">{isRTL ? 'الوجبة' : 'Meal'}</th>
                      <th className="px-4 py-4">{isRTL ? 'المبلغ' : 'Amount'}</th>
                      <th className="px-4 py-4">{isRTL ? 'الدفع' : 'Payment'}</th>
                      <th className="px-4 py-4">{isRTL ? 'الحالة' : 'Status'}</th>
                      <th className="px-4 py-4 text-center">{isRTL ? 'إجراء' : 'Action'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredOrders.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-10 text-center text-gray-400 font-bold">
                          {isRTL ? 'لا توجد طلبات مطابقة لهذا الفلتر.' : 'No orders match this filter.'}
                        </td>
                      </tr>
                    ) : (
                      filteredOrders.map(o => {
                        const statusCls = o.status === 'active'
                          ? 'bg-blue-50 text-blue-700 border-blue-100'
                          : o.status === 'completed'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-100'
                          : 'bg-red-50 text-red-700 border-red-100';
                        const statusLabel = o.status === 'active'
                          ? (isRTL ? 'قيد التنفيذ' : 'Active')
                          : o.status === 'completed'
                          ? (isRTL ? 'مكتملة' : 'Completed')
                          : (isRTL ? 'ملغاة' : 'Cancelled');
                        const isCod = o.paymentMethod !== 'online';
                        return (
                          <tr key={o.id} className="hover:bg-gray-50 transition-colors align-top">
                            <td className="px-4 py-4">
                              <span className="font-mono font-black text-gray-900 block">#{o.id.slice(0, 8).toUpperCase()}</span>
                              <span className="text-[10px] text-gray-400">{new Date(o.createdAt).toLocaleString()}</span>
                            </td>
                            <td className="px-4 py-4">
                              <span className="font-bold text-gray-900 block">{o.consumerName || '—'}</span>
                              {o.consumerPhone && (
                                <a href={`tel:${o.consumerPhone}`} className="font-mono text-[11px] text-primary hover:underline">{o.consumerPhone}</a>
                              )}
                            </td>
                            <td className="px-4 py-4 font-semibold text-gray-700">
                              {restaurantNameById[o.restaurantId] || o.restaurantId.slice(0, 8)}
                            </td>
                            <td className="px-4 py-4">
                              <span className="font-bold text-gray-800 block">{o.offerSnapshot?.name || '—'}</span>
                              <span className="text-[10px] text-gray-400 font-mono">x{o.quantity}</span>
                            </td>
                            <td className="px-4 py-4 font-mono font-black text-primary">{Number(o.totalPrice).toFixed(2)} MAD</td>
                            <td className="px-4 py-4">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-black ${isCod ? 'bg-amber-50 text-amber-800' : 'bg-indigo-50 text-indigo-800'}`}>
                                {isCod ? (isRTL ? 'عند الاستلام' : 'COD') : (isRTL ? 'إلكتروني' : 'Online')}
                              </span>
                              {o.paymentStatus && (
                                <span className="block mt-1 text-[9px] font-bold text-gray-400 uppercase">{o.paymentStatus}</span>
                              )}
                            </td>
                            <td className="px-4 py-4">
                              <span className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-black border ${statusCls}`}>
                                {statusLabel}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-center">
                              {o.status === 'active' ? (
                                <button
                                  onClick={() => handleAdminCancel(o.id)}
                                  disabled={cancellingId === o.id}
                                  className="bg-red-50 hover:bg-red-100 text-red-700 rounded-xl px-3 py-1.5 font-bold transition-colors cursor-pointer disabled:opacity-50"
                                >
                                  {cancellingId === o.id ? '…' : (isRTL ? 'إلغاء' : 'Cancel')}
                                </button>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 3: STATS & BESTSELLERS */}
          {activeTab === 'stats' && (
            <div className="space-y-6">

              {/* Reports row — sales / delivered / cancelled / cancellation rate */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
                  <span className="text-[11px] font-bold text-gray-400 block uppercase tracking-wider">{isRTL ? 'إجمالي المبيعات' : 'Total Sales'}</span>
                  <span className="text-2xl font-mono font-black text-primary mt-1 block">{analytics.revenue.toFixed(2)} MAD</span>
                </div>
                <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
                  <span className="text-[11px] font-bold text-gray-400 block uppercase tracking-wider">{isRTL ? 'طلبات مكتملة' : 'Completed Orders'}</span>
                  <span className="text-2xl font-display font-black text-emerald-600 mt-1 block">{analytics.completedOrders}</span>
                </div>
                <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
                  <span className="text-[11px] font-bold text-gray-400 block uppercase tracking-wider">{isRTL ? 'طلبات ملغاة' : 'Cancelled Orders'}</span>
                  <span className="text-2xl font-display font-black text-red-600 mt-1 block">{analytics.cancelledOrders}</span>
                </div>
                <div className="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm">
                  <span className="text-[11px] font-bold text-gray-400 block uppercase tracking-wider">{isRTL ? 'نسبة الإلغاء' : 'Cancellation Rate'}</span>
                  <span className="text-2xl font-display font-black text-gray-900 mt-1 block">{(analytics.cancellationRate * 100).toFixed(1)} %</span>
                  <span className="text-[10px] text-gray-400 font-bold">{analytics.mealsRescued} {isRTL ? 'وجبة أُنقذت' : 'meals rescued'}</span>
                </div>
              </div>

              <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
                <h3 className="text-lg font-black text-gray-900 mb-2">{isRTL ? 'أكثر الوجبات الفائضة طلباً' : 'Bestselling Surplus Food Types'}</h3>
                <p className="text-xs font-semibold text-gray-500 mb-6 leading-relaxed">
                  {isRTL ? 'ترتيب أعلى المنتجات التي لقت إعجابا وأنقذت من الهدر بناء على كميات المعاملات المكتملة.' : 'Leaderboard ranking the highest rescued items based on total quantity sold.'}
                </p>

                <div className="space-y-4">
                  {analytics.popularProducts.length === 0 ? (
                    <div className="border border-dashed border-gray-200 rounded-2xl py-12 text-center text-xs text-gray-400 font-bold">
                      {isRTL ? 'لا توجد مبيعات مسجلة حتى الآن لقراءة الأداء.' : 'No items sold yet. Check back once payments process.'}
                    </div>
                  ) : (
                    analytics.popularProducts.map((p, index) => (
                      <div key={p.name} className="flex items-center gap-4 bg-gray-50 p-4 rounded-2xl justify-between">
                        <div className="flex items-center gap-3">
                          <span className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[11px] ${
                            index === 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-200 text-gray-600'
                          }`}>
                            {index + 1}
                          </span>
                          <img src={p.image} className="w-10 h-10 object-cover rounded-xl" referrerPolicy="no-referrer" />
                          <div>
                            <p className="font-extrabold text-xs text-gray-900">{p.name}</p>
                            <p className="text-[10px] text-gray-400 font-bold font-mono">{p.count} units rescued</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-xs font-mono font-black text-primary block">{p.revenue.toFixed(2)} MAD</span>
                          <span className="text-[9px] text-gray-400 uppercase tracking-wider block font-bold">Gross volume</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          )}

          {/* TAB 4: SUPPORT SYSTEM */}
          {activeTab === 'support' && (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6">
              <div className="mb-6">
                <h3 className="text-lg font-black text-gray-900">{isRTL ? 'صندوق وارد دعم ومساعدة العملاء' : 'Active Support Ticket Queue'}</h3>
                <p className="text-xs font-semibold text-gray-500 leading-relaxed">
                  {isRTL 
                    ? 'الاستجابة لشكاوى المستهلكين والمحلات، والرد المباشر لحسم النزاعات وضمان ثقة Escrow.' 
                    : 'Analyze customer issues, check details, write answers, and resolve them instantly.'}
                </p>
              </div>

              <div className="space-y-5">
                {supportTickets.length === 0 ? (
                  <div className="border border-dashed border-gray-200 rounded-2xl py-12 text-center text-xs text-gray-400 font-bold">
                    {isRTL ? 'لم يتم رصد أي تذاكر دعم مفتوحة' : 'Inbox zero! No customer assistance request tickets.'}
                  </div>
                ) : (
                  supportTickets.map(ticket => (
                    <div 
                      key={ticket.id} 
                      className={`border rounded-2xl p-5 transition-all ${
                        ticket.status === 'resolved' 
                          ? 'border-gray-150 bg-gray-50/20 opacity-80' 
                          : 'border-rose-150 bg-rose-50/10'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row justify-between items-start gap-2 mb-3">
                        <div>
                          <span className="text-[10px] font-mono text-gray-400 block mb-1">ID: {ticket.id} — {new Date(ticket.createdAt).toLocaleString()}</span>
                          <h4 className="font-extrabold text-sm text-gray-900 leading-snug">{ticket.subject}</h4>
                        </div>
                        <span className={`px-2.5 py-1 rounded text-[10px] font-black ${
                          ticket.status === 'resolved' 
                            ? 'bg-emerald-50 text-emerald-800' 
                            : 'bg-rose-100 text-rose-800'
                        }`}>
                          {ticket.status === 'resolved' ? (isRTL ? 'محلولة ومغلقة' : 'Resolved') : (isRTL ? 'بانتظار رد المشرف' : 'Pending Response')}
                        </span>
                      </div>

                      <p className="text-xs text-gray-600 bg-white border border-gray-100 p-3.5 rounded-xl leading-relaxed mb-4">
                        {ticket.message}
                      </p>

                      <div className="flex flex-wrap items-center gap-2 mb-4 text-[11px] text-gray-500 font-semibold bg-gray-50 py-1.5 px-3 rounded-lg w-max">
                        <Users className="h-3.5 w-3.5 text-gray-400" />
                        <span>{ticket.userName} ({ticket.userEmail})</span>
                        <span className="text-gray-300">|</span>
                        <span className="capitalize">{ticket.userRole}</span>
                      </div>

                      {/* Resolved message feedback */}
                      {ticket.status === 'resolved' ? (
                        <div className="bg-emerald-50/40 border border-emerald-100 rounded-xl p-3.5 text-emerald-950 text-xs text-right">
                          <p className="font-extrabold mb-1 flex items-center gap-1 flex-row-reverse">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                            <span>{isRTL ? 'الرد الصادر من الإدارة:' : 'Administrator Response:'}</span>
                          </p>
                          <p className="font-semibold text-emerald-800 leading-relaxed font-sans">{ticket.response}</p>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <label className="block text-xs font-bold text-gray-700">{isRTL ? 'كتابة الرد:' : 'Compose administrative response:'}</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder={isRTL ? 'أكتب رسالة الرد لحل النزاع...' : 'Provide direct instruction / solution...'}
                              value={replyText[ticket.id] || ''}
                              onChange={(e) => setReplyText(prev => ({ ...prev, [ticket.id]: e.target.value }))}
                              className="flex-grow px-3 py-2 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-primary text-xs font-semibold bg-white"
                            />
                            <button
                              onClick={() => submitReply(ticket.id)}
                              className="bg-gray-950 hover:bg-gray-850 text-white rounded-xl px-4 py-2 text-xs font-black transition-all cursor-pointer flex items-center gap-1"
                            >
                              <Send className="h-3.5 w-3.5" />
                              <span>{isRTL ? 'إرسال وحل' : 'Reply & Resolve'}</span>
                            </button>
                          </div>
                        </div>
                      )}

                    </div>
                  ))
                )}
              </div>
            </div>
          )}

        </div>

      </div>
    </div>
  );
}
