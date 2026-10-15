export const firebaseConfig = {
  apiKey: 'AIzaSyDpzrmjg-B1w4auT3IcaqWyiyoGqSWE_8Y',
  authDomain: 'digicom-togo-6d3ea.firebaseapp.com',
  projectId: 'digicom-togo-6d3ea',
  storageBucket: 'digicom-togo-6d3ea.firebasestorage.app',
  messagingSenderId: '447351292831',
  appId: '1:447351292831:web:53afada40d4cef24f173aa',
};
export const FRAIS = 1000;
export const CATS = ['Mode', 'Électronique', 'Maison', 'Beauté', 'Alimentation', 'Enfants', 'Autres'];
export const PAY = { moov: 'Moov Money', mixx: 'Mixx by Yas', livraison: 'Paiement à la livraison' };
export const ETAPES = [['en_attente', 'Commande reçue'], ['assignee', 'Livreur assigné'], ['en_cours', 'En route vers toi'], ['livree', 'Livrée']];

if (typeof window !== 'undefined') {
  window.firebaseConfig = firebaseConfig;
  window.FRAIS = FRAIS;
  window.CATS = CATS;
  window.PAY = PAY;
  window.ETAPES = ETAPES;
}
