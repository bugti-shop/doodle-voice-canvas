import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyCi92VKS0fFRt8Ku6nxaROqjKcWYI3rCoY',
  authDomain: 'npd-all-in-one-notepad.firebaseapp.com',
  databaseURL: 'https://npd-all-in-one-notepad-default-rtdb.firebaseio.com',
  projectId: 'npd-all-in-one-notepad',
  storageBucket: 'npd-all-in-one-notepad.firebasestorage.app',
  messagingSenderId: '425291387152',
  appId: '1:425291387152:android:9e430f5614b3adb3411595',
};

export const firebaseApp = initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);
export const firebaseDb = getDatabase(firebaseApp);
export const googleProvider = new GoogleAuthProvider();
