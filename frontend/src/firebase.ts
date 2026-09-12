import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const env = (import.meta as any).env || {};

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "AIzaSyDV_InImNI4_mxNReuae4Zn2CosuEs7GXA",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "mineguard-6709e.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "mineguard-6709e",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "mineguard-6709e.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "825496480649",
  appId: env.VITE_FIREBASE_APP_ID || "1:825496480649:web:1455fd6c5be7b2723bcf58",
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || "G-M7T029E6CS"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export default app;
