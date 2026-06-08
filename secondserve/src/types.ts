export type UserRole = 'consumer' | 'restaurant' | 'admin';
export type CommerceType = 'Patisserie' | 'Superette' | 'Buffet à volonté';
export type City = 'Casablanca' | 'Mohammedia' | '';

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface User {
  id: string;
  role: UserRole;
  email: string;
  name: string;
  city: City;
  password?: string;
  approved?: boolean;
  banned?: boolean;
  // Restaurant specific
  commerceType?: CommerceType;
  address?: string;
  phone?: string;
  coordinates?: Coordinates;
  mapLink?: string;
}

export interface Offer {
  id: string;
  restaurantId: string;
  restaurantName: string;
  name: string;
  description: string;
  originalPrice: string | number;
  reducedPrice: string | number;
  quantity: number;
  image: string;
  timeLimit: string; // e.g., "20:00"
  city: City;
  commerceType: CommerceType;
  mealCategory?: string;
  rating?: number;
  isSurpriseBox?: boolean;
  address?: string;
  coordinates?: Coordinates;
  mapLink?: string;
}

export interface Order {
  id: string;
  offerId: string;
  consumerId: string;
  consumerName?: string;
  consumerPhone?: string;
  restaurantId: string;
  quantity: number;
  totalPrice: number;
  status: 'active' | 'cancelled' | 'completed';
  createdAt: string;
  offerSnapshot: Offer;
  paymentMethod?: 'online' | 'delivery';
  paymentStatus?: 'pending' | 'successful' | 'failed' | 'released';
  customerMessage?: string;
  pickupCode?: string;
  expiresAt?: string;
}

export interface Review {
  id: string;
  offerId: string;
  consumerId: string;
  consumerName: string;
  restaurantId: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  userRole: UserRole;
  subject: string;
  message: string;
  status: 'pending' | 'resolved';
  response?: string;
  createdAt: string;
}
