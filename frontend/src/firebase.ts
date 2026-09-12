import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAnalytics, isSupported } from "firebase/analytics";

const env = (import.meta as any).env || {};

// Web app's Firebase configuration
export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "AIzaSyACMqJxQ3Na3pKfE7CRq8BN-VGU4xCJNtE",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "mine-guard-1edbf.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "mine-guard-1edbf",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "mine-guard-1edbf.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "36537082476",
  appId: env.VITE_FIREBASE_APP_ID || "1:36537082476:web:ccfa70903d54942bf5ee49",
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID || "G-1X8MDE2PLE"
};

console.log(`[Firebase] Connecting to project: ${firebaseConfig.projectId}`);

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Initialize Analytics conditionally (only runs in supported browser environments)
export let analytics: any = null;
if (typeof window !== "undefined") {
  isSupported().then((supported) => {
    if (supported) {
      analytics = getAnalytics(app);
    }
  }).catch(() => {
    // Analytics optional in local dev
  });
}

export default app;