# 📲 SecondServe - Complete Firebase Integration Guide

This guide provides a step-by-step walkthrough to integrate **Firebase (Auth, Firestore, Cloud Storage, and Real-Time Notifications)** into the **SecondServe** application. 

The core Firebase SDK is already installed in your project, and the standard configuration has been provisioned! Below are the concrete steps, schemas, and example codes (JavaScript/TypeScript) to implement all the requested features securely.

---

## 🛠️ Step 1: Firebase Project Setup

### 1. Enable Services in Firebase Console
Go to the [Firebase Console](https://console.firebase.google.com/) for your project:
1. **Authentication**:
   * Navigate to **Build > Authentication > Get Started**.
   * Enable the **Email/Password** sign-in method.
   * Enable the **Google** sign-in method (if you wish to support simple one-click logins).
2. **Cloud Firestore**:
   * Navigate to **Build > Firestore Database > Create Database**.
   * Choose your location (e.g., `europe-west1`) and start in **Production mode**.
3. **Storage**:
   * Navigate to **Build > Storage > Get Started**.
   * Create standard storage buckets to store product/bag images.

---

## 📄 Step 2: Connection & Configurations

The configuration is already saved locally inside your workspace root in the `firebase-applet-config.json` file. Here is how your frontend initializes the connection:

```javascript
// Located in /src/lib/firebase.ts
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase App
const app = initializeApp(firebaseConfig);

// Initialize Services
export const auth = getAuth(app);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const storage = getStorage(app);
```

---

## 👥 Step 3: Authentication Implementation

We distinguish three roles: `admin`, `restaurant` (partners), and `consumer` (users). All profiles are stored in Firestore inside the `/users/{userId}` collection to allow advanced queries and state tracking (approved, banned).

### 1. Register User / Partner
When registering a new account, we create the credentials in Firebase Auth and record the profile inside Firestore.

```javascript
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

async function handleSignUp(email, password, displayName, role, extraFields = {}) {
  try {
    // 1. Create the Auth record
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const userId = userCredential.user.uid;

    // 2. Prepare the Firestore profile
    const profile = {
      id: userId,
      email: email,
      name: displayName,
      role: role, // 'consumer', 'restaurant', or 'admin'
      approved: role === 'restaurant' ? false : true, // partners need approval
      banned: false,
      createdAt: new Date().toISOString(),
      ...extraFields // e.g., commerceType, address, phone for partners
    };

    // 3. Save to database
    await setDoc(doc(db, 'users', userId), profile);
    return profile;
  } catch (error) {
    console.error("SignUp Error:", error.message);
    throw error;
  }
}
```

### 2. Login (for Users, Partners, and Admins)
When logging in, we authenticate the user, fetch their user profile document from Firestore, and populate their role state.

```javascript
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

async function handleLogin(email, password) {
  try {
    // Authenticate
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    const userId = userCredential.user.uid;

    // Fetch firestore profile to assert permissions/roles
    const docSnap = await getDoc(doc(db, 'users', userId));
    if (docSnap.exists()) {
      const profile = docSnap.data();
      if (profile.banned) {
        throw new Error("This account is currently blocked.");
      }
      return profile; // Returns profile containing { role: 'admin' | 'restaurant' | 'consumer' }
    } else {
      throw new Error("User profile not found in database.");
    }
  } catch (error) {
    console.error("Login Error:", error.message);
    throw error;
  }
}
```

---

## 💾 Step 4: Database Schemes & Operations

We use the collections as structured below:

### 1. Store Product Offers (`/offers`)
```javascript
import { collection, addDoc, updateDoc, deleteDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';

// Add new product offer (For Partners)
async function createOffer(partnerId, partnerName, offerData) {
  const newOffer = {
    restaurantId: partnerId,
    restaurantName: partnerName,
    name: offerData.name,
    description: offerData.description,
    originalPrice: Number(offerData.originalPrice),
    reducedPrice: Number(offerData.reducedPrice),
    quantity: Number(offerData.quantity),
    image: offerData.imageURL, // From Firebase Storage upload
    timeLimit: offerData.timeLimit,
    city: offerData.city,
    commerceType: offerData.commerceType, // 'Patisserie', 'Superette', or 'Buffet à volonté'
    mealCategory: offerData.mealCategory || 'Baked Goods',
    isSurpriseBox: offerData.isSurpriseBox || false,
    createdAt: new Date().toISOString()
  };

  const docRef = await addDoc(collection(db, 'offers'), newOffer);
  return { id: docRef.id, ...newOffer };
}
```

### 2. Place Orders (`/orders`)
```javascript
import { collection, addDoc, doc, updateDoc, increment } from 'firebase/firestore';
import { db } from '../lib/firebase';

// Place an order (For Consumers)
async function placeOrder(consumerId, consumerName, offer, quantity) {
  const totalPrice = Number(offer.reducedPrice) * quantity;
  
  const orderData = {
    offerId: offer.id,
    consumerId: consumerId,
    consumerName: consumerName,
    restaurantId: offer.restaurantId,
    quantity: quantity,
    totalPrice: totalPrice,
    status: 'active', // 'active' | 'cancelled' | 'completed'
    createdAt: new Date().toISOString(),
    offerSnapshot: offer,
    paymentMethod: 'delivery'
  };

  // 1. Create Order Document
  const docRef = await addDoc(collection(db, 'orders'), orderData);

  // 2. Reduce Available stock in the corresponding Offer document
  await updateDoc(doc(db, 'offers', offer.id), {
    quantity: increment(-quantity)
  });

  // 3. Trigger Real-time Notification
  await createNotification(offer.restaurantId, docRef.id, consumerName, offer.name, totalPrice);

  return { id: docRef.id, ...orderData };
}
```

---

## 🔔 Step 5: Real-time Notifications

When a user places an order, we write a document to `/notifications`. The partner registers a real-time snapshot listener on their dashboard page that triggers instant alerts (such as the chime sound).

### 1. Create Notification (Triggered automatically upon ordering)
```javascript
import { collection, addDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';

async function createNotification(recipientPartnerId, orderId, customerName, offerName, total) {
  const notif = {
    recipientId: recipientPartnerId, 
    orderId: orderId,
    customerName: customerName,
    offerName: offerName,
    totalPrice: total,
    paymentMethod: 'delivery',
    read: false,
    createdAt: new Date().toISOString()
  };
  await addDoc(collection(db, 'notifications'), notif);
}
```

### 2. Listen Real-time (Active on Partner / Restaurant Dashboard)
```javascript
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';

function listenForPartnerNotifications(partnerId, onNewNotificationCallback) {
  const q = query(
    collection(db, 'notifications'), 
    where('recipientId', '==', partnerId),
    where('read', '==', false)
  );

  // Set real-time listener
  const unsubscribe = onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const notif = { id: change.doc.id, ...change.doc.data() };
        onNewNotificationCallback(notif); // Callback to sound chime & show alerts
      }
    });
  });

  return unsubscribe; // Call this function to stop listening when page unmounts
}
```

---

## 🖼️ Step 6: Storage (Uploading Product Images)

Upload files directly using the Firebase Cloud Storage API:

```javascript
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../lib/firebase';

async function uploadProductImage(file) {
  try {
    const filename = `${Date.now()}_${file.name}`;
    const storageRef = ref(storage, `products/${filename}`);
    
    // Upload the raw file bytes
    await uploadBytes(storageRef, file);
    
    // Get public URL
    const downloadURL = await getDownloadURL(storageRef);
    return downloadURL;
  } catch (error) {
    console.error("Image Upload Failed:", error);
    throw error;
  }
}
```

---

## 🛡️ Step 7: Admin Panel Implementation

Admins can load all user registers, partner stores, and reservation histories. Below are the administrative query handlers:

```javascript
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';

// Fetch users
async function adminGetAllUsers() {
  const querySnapshot = await getDocs(collection(db, 'users'));
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// Fetch all orders
async function adminGetAllOrders() {
  const querySnapshot = await getDocs(collection(db, 'orders'));
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}
```

---

## 🔗 Step 8: How to Connect Current UI Context

To easily switch from mock mockups or `localStorage` to live Firebase, adapt your `AppContext` providers:
1. Swap local states with direct real-time snapshot listeners or `async` fetchers on mount:
   ```javascript
   useEffect(() => {
     if (auth.currentUser) {
       // Listen to users live orders
       const unsub = onSnapshot(query(collection(db, 'orders')), (snapshot) => {
          setOrders(snapshot.docs.map(d => ({id: d.id, ...d.data()})));
       });
       return () => unsub();
     }
   }, []);
   ```
2. When performing updates or writes, wrap each in `try-catch` structures calling the standard helper `handleFirestoreError` so permissions are continuously tested and hardened!
