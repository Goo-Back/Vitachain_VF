export type SsUser = {
  id: string;
  role: "consumer" | "restaurant" | "admin";
  email: string;
  name: string;
  city: string;
  approved: boolean;
  banned: boolean;
  commerce_type: string | null;
  address: string | null;
  phone: string | null;
  created_at: string;
};

export type SsOrder = {
  id: string;
  consumer_id: string;
  consumer_name: string | null;
  consumer_phone: string | null;
  restaurant_id: string;
  quantity: number;
  total_price: number;
  status: "active" | "cancelled" | "completed";
  payment_method: string;
  payment_status: string;
  offer_snapshot: { id?: string; name?: string; image?: string } & Record<
    string,
    unknown
  >;
  created_at: string;
};

export type SsTicket = {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  user_role: string;
  subject: string;
  message: string;
  status: "pending" | "resolved";
  response: string | null;
  created_at: string;
};

export type SsPopularProduct = {
  name: string;
  image: string;
  count: number;
  revenue: number;
};

export type SsStats = {
  total_users: number;
  total_partners: number;
  total_orders: number;
  active_orders: number;
  completed_orders: number;
  cancelled_orders: number;
  open_tickets: number;
  revenue: number;
  meals_rescued: number;
  cancellation_rate: number;
  popular_products: SsPopularProduct[];
};

export type SsPage<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};
