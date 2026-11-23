
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";

import {
  getFirestore,
  doc,
  setDoc,
  getDoc
} from "https://www.gstatic.com/firebasejs/12.6.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyClUDdEkgclx3qwciWDTk76BY7bU_mav4U",
  authDomain: "ev-charge-spot-b8461.firebaseapp.com",
  projectId: "ev-charge-spot-b8461",
  storageBucket: "ev-charge-spot-b8461.firebasestorage.app",
  messagingSenderId: "193673668195",
  appId: "1:193673668195:web:f89725cdf49a5d96367a56",
  measurementId: "G-T7G4YQT329"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

window.firebaseAuth = auth;
window.firebaseDb = db;
window.firebaseFunctions = {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  doc,
  setDoc,
  getDoc
};

console.log("EV Charge Spot Firebase connected!");
