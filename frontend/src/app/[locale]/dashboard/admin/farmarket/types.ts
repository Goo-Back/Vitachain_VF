export type OrderStatus =
  | "PENDING"
  | "PARTIALLY_ACCEPTED"
  | "ACCEPTED"
  | "REJECTED"
  | "IN_PROGRESS"
  | "DELIVERED"
  | "CANCELLED"
  | "RETURNED";

export type AdminOrderListItem = {
  id: string;
  restaurant_id: string;
  status: OrderStatus;
  delivery_region: string;
  delivery_notes: string | null;
  delivery_contact_name: string | null;
  delivery_phone: string | null;
  delivery_address: string | null;
  delivery_city: string | null;
  subtotal_mad: string;
  logistics_fee_mad: string;
  total_mad: string;
  payment_method: "COD" | "PSP_TRANSFER";
  payment_status: "DUE" | "PAID" | "FAILED" | "SIMULATED_PAID" | "PENDING";
  paid_at: string | null;
  created_at: string;
  updated_at: string;
  age_days: number | null;
};

export type AdminStats = {
  orders_total: number;
  orders_by_status: Record<string, number>;
  delivered_count: number;
  cancelled_count: number;
  rejected_count: number;
  returned_count: number;
  revenue_booked_mad: string;
  revenue_collected_mad: string;
  cod_outstanding_mad: string;
  products_sold_kg: string;
  cancellation_rate: number;
  return_rate: number;
};

export type PaymentAuditRow = {
  id: string;
  order_id: string;
  actor_id: string;
  actor_role: "RESTAURANT" | "ADMIN" | "SYSTEM";
  previous_status: string;
  new_status: string;
  previous_paid_at: string | null;
  new_paid_at: string | null;
  reason: string;
  created_at: string;
};
