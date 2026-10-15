import React, { useState, useEffect, useContext, createContext } from 'react';
import { createRoot } from 'react-dom/client';
import htm from 'htm';
import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, collection, doc, getDoc, setDoc, onSnapshot, query, where, writeBatch, increment, serverTimestamp } from 'firebase/firestore';
import { firebaseConfig, FRAIS, CATS, PAY, ETAPES } from './config.js';

const html = htm.bind(React.createElement);
const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb, 'default');

// ---------- utilitaires ----------
const fcfa = (n) => (Number(n) || 0).toLocaleString('fr-FR') + ' F';
const ms = (v) => (v && v.toMillis ? v.toMillis() : v ? new Date(v).getTime() : 0);
const normTel = (s) => { let d = String(s).replace(/\D/g, ''); if (d.startsWith('228') && d.length > 8) d = d.slice(3); return d; };
const telMail = (d) => `228${d}@digicom.tg`; // le numéro sert d'identifiant
const prixEff = (p) => (p.prixPromo > 0 && (!p.promoFin || ms(p.promoFin) > Date.now()) ? p.prixPromo : p.prix);
const enPromo = (p) => prixEff(p) < p.prix;
const visible = (p) => p.actif !== false && ms(p.abonneFin) > Date.now() && (p.statut === undefined || p.statut === 'valide');
const go = (p) => { location.hash = p; };
const erreur = (e) => {
  const c = e?.code || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Numéro ou mot de passe incorrect.';
  if (c.includes('email-already-in-use')) return 'Ce numéro a déjà un compte. Connecte-toi.';
  if (c.includes('weak-password')) return 'Mot de passe trop court (6 caractères minimum).';
  if (c.includes('network')) return 'Pas de connexion internet.';
  if (c.includes('permission-denied')) return 'Action refusée. Réessaie ou contacte le support.';
  return e?.message || 'Une erreur est survenue.';
};
const useHash = () => {
  const [h, setH] = useState(location.hash.slice(1) || '/');
  useEffect(() => { const f = () => { setH(location.hash.slice(1) || '/'); scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  return h;
};
const useLive = (mk, deps) => {
  const [d, setD] = useState(null);
  useEffect(() => { const q = mk(); if (!q) { setD([]); return; } return onSnapshot(q, (s) => setD(s.docs.map((x) => ({ id: x.id, ...x.data() }))), (e) => { console.error(e); setD([]); }); }, deps);
  return d;
};

// ---------- contexte ----------
const Ctx = createContext(null);
const useC = () => useContext(Ctx);

function App() {
  const hash = useHash();
  const [sess, setSess] = useState({ user: null, profile: null, ready: false, err: '' });
  const [cart, setCart] = useState(() => { try { return JSON.parse(localStorage.getItem('dc_panier')) || []; } catch { return []; } });
  useEffect(() => { try { localStorage.setItem('dc_panier', JSON.stringify(cart)); } catch {} }, [cart]);

  const charger = async (u) => {
    if (!u) { setSess({ user: null, profile: null, ready: true, err: '' }); return; }
    try {
      const s = await getDoc(doc(db, 'users', u.uid));
      if (!s.exists() || s.data().role !== 'acheteur' || s.data().actif === false) {
        await signOut(auth);
        setSess({ user: null, profile: null, ready: true, err: "Ce compte ne peut pas utiliser cette application (équipe : utilise DigiCom Pro)." });
        return;
      }
      setSess({ user: u, profile: { uid: u.uid, ...s.data() }, ready: true, err: '' });
    } catch (e) { setSess({ user: null, profile: null, ready: true, err: erreur(e) }); }
  };
  useEffect(() => onAuthStateChanged(auth, (u) => { if (!window.__ins) charger(u); }), []);

  const produitsBruts = useLive(() => collection(db, 'produits'), []);
  const produits = (produitsBruts || []).filter(visible).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
  const favDoc = useLive(() => (sess.user ? query(collection(db, 'favoris'), where('uid', '==', sess.user.uid)) : null), [sess.user?.uid]);
  const favs = favDoc && favDoc[0] ? favDoc[0].ids || [] : [];

  const toggleFav = async (id) => {
    if (!sess.user) return go('/compte');
    const ids = favs.includes(id) ? favs.filter((x) => x !== id) : [...favs, id];
    await setDoc(doc(db, 'favoris', sess.user.uid), { uid: sess.user.uid, ids });
  };
  const ajouter = (p, q = 1) => setCart((l) => {
    const ex = l.find((i) => i.id === p.id);
    if (ex) return l.map((i) => (i.id === p.id ? { ...i, qte: Math.min(p.stock, i.qte + q) } : i));
    return [...l, { id: p.id, nom: p.nom, image: p.images?.[0]?.url || '', qte: Math.min(p.stock, q), abonneId: p.abonneId, abonneNom: p.abonneNom || '' }];
  });
  const nbPanier = cart.reduce((s, i) => s + i.qte, 0);
  const v = { ...sess, charger: () => charger(auth.currentUser), produits, favs, toggleFav, cart, setCart, ajouter };

  let page;
  const [, r, a] = hash.split('/');
  if (!sess.ready || produitsBruts === null) page = html`<div className="plein"><div className="spin" /></div>`;
  else if (r === 'p') page = html`<${Produit} id=${a} />`;
  else if (r === 'b') page = html`<${Boutique} id=${a} />`;
  else if (r === 'favoris') page = html`<${Favoris} />`;
  else if (r === 'panier') page = html`<${Panier} />`;
  else if (r === 'commandes') page = html`<${Commandes} />`;
  else if (r === 'c') page = html`<${Suivi} id=${a} />`;
  else if (r === 'compte') page = html`<${Compte} />`;
  else page = html`<${Accueil} />`;

  const Tab = (p, ico, label, key) => html`<a href=${'#/' + p} className=${(r || '') === key ? 'on' : ''}><b>${ico}</b>${label}</a>`;
  return html`<${Ctx.Provider} value=${v}>
    <div className="app">
      <header className="hero"><b>DigiCom Togo</b> <small style=${{ opacity: .85 }}>· la boutique du Togo</small></header>
      <main className="page">${page}</main>
      <nav className="tabbar">
        ${Tab('', '🏠', 'Accueil', '')}${Tab('favoris', '♥', 'Favoris', 'favoris')}${Tab('panier', '🛒', 'Panier' + (nbPanier ? ` (${nbPanier})` : ''), 'panier')}${Tab('commandes', '📦', 'Commandes', 'commandes')}${Tab('compte', '👤', 'Compte', 'compte')}
      </nav>
    </div><//>`;
}

// ---------- éléments ----------
const Prix = ({ p }) => html`<span className="prix">${fcfa(prixEff(p))}</span>${enPromo(p) && html`<span className="barre">${fcfa(p.prix)}</span>`}`;
const Carte = ({ p }) => {
  const { favs, toggleFav } = useC();
  return html`<div className="prod">
    ${p.stock <= 0 && html`<span className="epuise">Épuisé</span>`}${p.stock > 0 && enPromo(p) && html`<span className="promo-b">Promo</span>`}
    <button className="coeur" onClick=${() => toggleFav(p.id)} aria-label="Favori">${favs.includes(p.id) ? '❤️' : '🤍'}</button>
    <a href=${'#/p/' + p.id} style=${{ color: 'inherit', textDecoration: 'none' }}>
      <img src=${p.images?.[0]?.url} alt=${p.nom} loading="lazy" />
      <div className="inf"><b>${p.nom}</b><${Prix} p=${p} /><br /><small className="gris">${p.abonneNom}</small></div>
    </a></div>`;
};

function Accueil() {
  const { produits } = useC();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const liste = produits.filter((p) => (!cat || p.categorie === cat) && (!q || (p.nom + ' ' + (p.description || '')).toLowerCase().includes(q.toLowerCase())));
  const offres = produits.filter((p) => enPromo(p) && p.stock > 0);
  return html`<div>
    <input placeholder="Rechercher un produit…" value=${q} onChange=${(e) => setQ(e.target.value)} />
    <div className="chips">${['', ...CATS].map((c) => html`<button key=${c} className=${cat === c ? 'on' : ''} onClick=${() => setCat(c)}>${c || 'Tout'}</button>`)}</div>
    ${!q && !cat && offres.length > 0 && html`<h2>🔥 Offres du jour</h2><div className="rang">${offres.map((p) => html`<${Carte} key=${p.id} p=${p} />`)}</div><h2 style=${{ marginTop: 14 }}>Tous les produits</h2>`}
    ${!liste.length && html`<p className="vide">Aucun produit trouvé.</p>`}
    <div className="grille">${liste.map((p) => html`<${Carte} key=${p.id} p=${p} />`)}</div></div>`;
}

function Produit({ id }) {
  const { produits, ajouter, favs, toggleFav, cart } = useC();
  const [qte, setQte] = useState(1);
  const [ok, setOk] = useState(false);
  const p = produits.find((x) => x.id === id);
  if (!p) return html`<p className="vide">Produit indisponible.</p>`;
  const deja = cart.find((i) => i.id === p.id)?.qte || 0;
  const reste = p.stock - deja;
  const wa = 'https://wa.me/?text=' + encodeURIComponent(`${p.nom} – ${fcfa(prixEff(p))} sur DigiCom Togo ${location.origin}${location.pathname}#/p/${p.id}`);
  return html`<div>
    <button className="btn mini gris-b" onClick=${() => history.back()}>← Retour</button>
    <div className="galerie" style=${{ marginTop: 10 }}>${(p.images || []).map((im, i) => html`<img key=${i} src=${im.url} alt=${p.nom} />`)}</div>
    <h2 style=${{ marginTop: 12 }}>${p.nom}</h2>
    <p className="total"><${Prix} p=${p} /></p>
    <p><a href=${'#/b/' + p.abonneId}>🏪 ${p.abonneNom}</a> · <small className="gris">${p.categorie} · ${p.stock > 0 ? p.stock + ' en stock' : 'épuisé'}</small></p>
    <p style=${{ margin: '10px 0', whiteSpace: 'pre-wrap' }}>${p.description}</p>
    ${reste > 0 ? html`<div className="qte"><button onClick=${() => setQte(Math.max(1, qte - 1))}>−</button><b>${qte}</b><button onClick=${() => setQte(Math.min(reste, qte + 1))}>+</button></div>
      <button className="btn plein-l" onClick=${() => { ajouter(p, qte); setOk(true); }}>Ajouter au panier</button>` : html`<p className="alerte info">${p.stock > 0 ? 'Tout le stock est déjà dans ton panier.' : 'Produit épuisé.'}</p>`}
    ${ok && html`<p className="alerte ok">Ajouté ! <a href="#/panier">Voir le panier</a></p>`}
    <div className="actions"><button className="btn gris-b" onClick=${() => toggleFav(p.id)}>${favs.includes(p.id) ? '❤️ Dans mes favoris' : '🤍 Ajouter aux favoris'}</button><a className="wa" href=${wa} target="_blank" rel="noopener">Partager sur WhatsApp</a></div></div>`;
}

function Boutique({ id }) {
  const { produits } = useC();
  const l = produits.filter((p) => p.abonneId === id);
  return html`<div><button className="btn mini gris-b" onClick=${() => history.back()}>← Retour</button>
    <h2 style=${{ marginTop: 10 }}>🏪 ${l[0]?.abonneNom || 'Boutique'}</h2><p className="gris">${l.length} produit${l.length > 1 ? 's' : ''}</p>
    ${!l.length && html`<p className="vide">Cette boutique n'a aucun produit disponible.</p>`}
    <div className="grille">${l.map((p) => html`<${Carte} key=${p.id} p=${p} />`)}</div></div>`;
}

function Favoris() {
  const { produits, favs, user } = useC();
  if (!user) return html`<${Invite} texte="Connecte-toi pour garder tes produits préférés." />`;
  const l = produits.filter((p) => favs.includes(p.id));
  return html`<div><h2>Mes favoris</h2>${!l.length && html`<p className="vide">Touche le ♥ sur un produit pour l'ajouter ici.</p>`}<div className="grille">${l.map((p) => html`<${Carte} key=${p.id} p=${p} />`)}</div></div>`;
}

const Invite = ({ texte }) => html`<div className="carte"><h2>Compte requis</h2><p className="gris">${texte}</p><a className="btn plein-l" style=${{ display: 'block', textAlign: 'center', textDecoration: 'none' }} href="#/compte">Connexion / Inscription</a></div>`;

function Panier() {
  const { cart, setCart, produits, user, profile } = useC();
  const [f, setF] = useState({ adresse: '', quartier: '', tel: profile?.tel || '' });
  const [mode, setMode] = useState('moov');
  const [refs, setRefs] = useState({});
  const [vend, setVend] = useState({});
  const [code, setCode] = useState('');
  const [promo, setPromo] = useState(null);
  const [msg, setMsg] = useState({ t: '', m: '' });
  const [busy, setBusy] = useState(false);

  const lignes = cart.map((i) => { const p = produits.find((x) => x.id === i.id); return p && p.stock > 0 ? { ...i, nom: p.nom, prix: prixEff(p), stock: p.stock, qte: Math.min(i.qte, p.stock) } : null; }).filter(Boolean);
  const ids = [...new Set(lignes.map((l) => l.abonneId))];
  useEffect(() => { if (!user) return; ids.forEach((id) => { if (vend[id] === undefined) getDoc(doc(db, 'boutiques', id)).then((s) => setVend((v) => ({ ...v, [id]: s.exists() ? s.data() : {} }))).catch(() => {}); }); }, [lignes.length, user?.uid]);

  if (!lignes.length) return html`<p className="vide">Ton panier est vide. <a href="#/">Voir les produits</a></p>`;
  const sous = lignes.reduce((s, l) => s + l.prix * l.qte, 0);
  const remise = promo ? Math.min(sous, promo.type === 'pourcent' ? Math.round((sous * promo.valeur) / 100) : promo.valeur) : 0;
  const total = sous - remise + FRAIS;
  const mobile = mode !== 'livraison';
  const setQte = (id, q) => setCart(cart.map((i) => (i.id === id ? { ...i, qte: Math.max(1, q) } : i)));

  const appliquer = async () => {
    setMsg({ t: '', m: '' });
    try {
      const s = await getDoc(doc(db, 'promos', code.trim().toUpperCase()));
      const d = s.exists() ? s.data() : null;
      if (!d || d.actif === false || (d.fin && ms(d.fin) < Date.now()) || (d.min && sous < d.min)) { setPromo(null); return setMsg({ t: 'err', m: 'Code invalide, expiré ou panier trop petit.' }); }
      setPromo({ code: s.id, type: d.type, valeur: Number(d.valeur) });
      setMsg({ t: 'ok', m: 'Code appliqué !' });
    } catch (e) { setMsg({ t: 'err', m: 'Impossible de vérifier le code.' }); }
  };

  const commander = async (e) => {
    e.preventDefault();
    if (mobile && ids.some((id) => !(refs[id] || '').trim())) return setMsg({ t: 'err', m: 'Saisis la référence de transaction pour chaque vendeur.' });
    setBusy(true);
    try {
      const cRef = doc(collection(db, 'commandes'));
      const b = writeBatch(db);
      b.set(cRef, {
        acheteurId: user.uid, acheteurNom: profile.nom, telephone: f.tel.trim(), adresse: f.adresse.trim(), quartier: f.quartier.trim(),
        items: lignes.map((l) => ({ id: l.id, nom: l.nom, prix: l.prix, qte: l.qte, abonneId: l.abonneId, abonneNom: l.abonneNom })),
        abonneIds: ids, sousTotal: sous, remise, promo: promo ? promo.code : null, frais: FRAIS, total,
        paiement: { mode, refs: mobile ? refs : {} }, statut: 'en_attente', livreurId: null, livreurNom: null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      });
      lignes.forEach((l) => b.update(doc(db, 'produits', l.id), { stock: increment(-l.qte), vendus: increment(l.qte) }));
      await b.commit();
      setCart([]);
      go('/c/' + cRef.id);
    } catch (x) { setMsg({ t: 'err', m: x.code === 'permission-denied' ? 'Stock insuffisant pour un produit. Réduis les quantités.' : erreur(x) }); }
    setBusy(false);
  };

  return html`<form onSubmit=${commander}><h2>Mon panier</h2>
    ${lignes.map((l) => html`<div className="carte item" key=${l.id}><img src=${l.image} alt="" /><div><b>${l.nom}</b><br /><small className="gris">${l.abonneNom}</small><br /><span className="prix">${fcfa(l.prix * l.qte)}</span>
      <div className="qte" style=${{ marginLeft: 10 }}><button type="button" onClick=${() => setQte(l.id, l.qte - 1)}>−</button><b>${l.qte}</b><button type="button" onClick=${() => setQte(l.id, Math.min(l.stock, l.qte + 1))}>+</button></div></div>
      <button type="button" className="btn mini gris-b" onClick=${() => setCart(cart.filter((i) => i.id !== l.id))}>✕</button></div>`)}
    <div className="carte"><label>Code promo</label><div className="deux"><input value=${code} onChange=${(e) => setCode(e.target.value)} placeholder="EX : BIENVENUE" /><button type="button" className="btn gris-b" onClick=${appliquer}>Appliquer</button></div></div>
    <div className="carte"><div className="ligne"><span>Sous-total</span><span>${fcfa(sous)}</span></div>
      ${remise > 0 && html`<div className="ligne"><span>Remise (${promo.code})</span><span>− ${fcfa(remise)}</span></div>`}
      <div className="ligne"><span>Livraison</span><span>${fcfa(FRAIS)}</span></div><div className="ligne total"><span>Total</span><span>${fcfa(total)}</span></div></div>
    ${msg.m && html`<p className=${'alerte ' + msg.t}>${msg.m}</p>`}
    ${!user ? html`<${Invite} texte="Crée ton compte (30 secondes) pour valider ta commande. Ton panier est conservé." />` : html`
    <div className="carte"><h3>Livraison</h3><label>Quartier</label><input value=${f.quartier} onChange=${(e) => setF({ ...f, quartier: e.target.value })} placeholder="Ex. Tokoin, Adidogomé, Bè…" required />
      <label>Adresse précise (repère)</label><textarea value=${f.adresse} onChange=${(e) => setF({ ...f, adresse: e.target.value })} required />
      <label>Téléphone</label><input type="tel" value=${f.tel} onChange=${(e) => setF({ ...f, tel: e.target.value })} required />
      <h3>Paiement</h3><select value=${mode} onChange=${(e) => setMode(e.target.value)}>${Object.entries(PAY).map(([k, n]) => html`<option key=${k} value=${k}>${n}</option>`)}</select>
      ${mobile && ids.map((id) => { const b = vend[id] || {}; const nom = lignes.find((l) => l.abonneId === id).abonneNom; const part = lignes.filter((l) => l.abonneId === id).reduce((s, l) => s + l.prix * l.qte, 0);
        return html`<div key=${id} style=${{ marginTop: 10 }}><p className="alerte info">Envoie <b>${fcfa(part)}</b> à <b>${nom}</b> par ${PAY[mode]} : <b>${(mode === 'moov' ? b.moov : b.mixx) || 'numéro non renseigné'}</b></p>
        <label>Référence de transaction (${nom})</label><input value=${refs[id] || ''} onChange=${(e) => setRefs({ ...refs, [id]: e.target.value })} placeholder="ID reçu par SMS" /></div>`; })}
    </div><button className="btn plein-l" disabled=${busy}>${busy ? 'Envoi…' : 'Confirmer la commande · ' + fcfa(total)}</button>`}</form>`;
}

function Commandes() {
  const { user } = useC();
  const cmds = useLive(() => (user ? query(collection(db, 'commandes'), where('acheteurId', '==', user.uid)) : null), [user?.uid]);
  if (!user) return html`<${Invite} texte="Connecte-toi pour suivre tes commandes." />`;
  if (!cmds) return html`<div className="plein"><div className="spin" /></div>`;
  if (!cmds.length) return html`<p className="vide">Tu n'as pas encore commandé.</p>`;
  return html`<div><h2>Mes commandes</h2>${cmds.sort((a, b) => ms(b.createdAt) - ms(a.createdAt)).map((o) => html`<a key=${o.id} href=${'#/c/' + o.id} className="carte" style=${{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
    <div className="ligne"><b>#${o.id.slice(0, 6).toUpperCase()}</b><span className=${'badge ' + o.statut}>${(ETAPES.find((e) => e[0] === o.statut) || [])[1]}</span></div>
    <small className="gris">${o.items.length} article${o.items.length > 1 ? 's' : ''} · ${fcfa(o.total)}</small></a>`)}</div>`;
}

function Suivi({ id }) {
  const { user } = useC();
  const [o, setO] = useState(undefined);
  const [wa, setWa] = useState({});
  useEffect(() => { if (!user) return; return onSnapshot(doc(db, 'commandes', id), (s) => setO(s.exists() ? { id: s.id, ...s.data() } : null), () => setO(null)); }, [id, user?.uid]);
  useEffect(() => { if (!o) return; o.abonneIds.forEach((a) => getDoc(doc(db, 'boutiques', a)).then((s) => setWa((w) => ({ ...w, [a]: s.exists() ? (s.data().whatsapp || s.data().moov || '') : '' }))).catch(() => {})); }, [o?.id]);
  if (!user) return html`<${Invite} texte="Connecte-toi pour voir cette commande." />`;
  if (o === undefined) return html`<div className="plein"><div className="spin" /></div>`;
  if (!o) return html`<p className="vide">Commande introuvable.</p>`;
  const k = ETAPES.findIndex((e) => e[0] === o.statut);
  return html`<div><a className="btn mini gris-b" href="#/commandes" style=${{ textDecoration: 'none' }}>← Mes commandes</a>
    <h2 style=${{ marginTop: 10 }}>Commande #${o.id.slice(0, 6).toUpperCase()}</h2><p className="alerte ok">Suivi en direct : cette page se met à jour toute seule.</p>
    <div className="carte">${ETAPES.map((e, i) => html`<div key=${e[0]} className=${'etape' + (i <= k ? ' fait' : '')}><i /><span>${e[1]}</span></div>`)}
      ${o.livreurNom && html`<small className="gris">Livreur : ${o.livreurNom}</small>`}</div>
    ${o.preuve?.photo && html`<div className="carte"><b>📸 Preuve de livraison</b><img src=${o.preuve.photo} alt="Preuve" style=${{ width: '100%', borderRadius: 8, marginTop: 8 }} /></div>`}
    ${o.abonneIds.map((a) => { const n = (o.items.find((i) => i.abonneId === a) || {}).abonneNom; const t = String(wa[a] || '').replace(/\D/g, ''); return t.length >= 8 ? html`<p key=${a}><a className="wa" target="_blank" rel="noopener" href=${'https://wa.me/' + (t.length === 8 ? '228' + t : t) + '?text=' + encodeURIComponent('Bonjour, ma commande DigiCom #' + o.id.slice(0, 6).toUpperCase())}>💬 Écrire à ${n} sur WhatsApp</a></p>` : null; })}
    <div className="carte"><ul className="art" style=${{ listStyle: 'none', padding: 0 }}>${o.items.map((i, n) => html`<li key=${n} className="ligne"><span>${i.qte} × ${i.nom}</span><span>${fcfa(i.prix * i.qte)}</span></li>`)}</ul>
      ${o.remise > 0 && html`<div className="ligne"><span>Remise ${o.promo || ''}</span><span>− ${fcfa(o.remise)}</span></div>`}
      <div className="ligne"><span>Livraison</span><span>${fcfa(o.frais)}</span></div><div className="ligne total"><span>Total</span><span>${fcfa(o.total)}</span></div>
      <small className="gris">📍 ${o.adresse}</small></div></div>`;
}

function Compte() {
  const { user, profile, charger, err } = useC();
  const [ins, setIns] = useState(false);
  const [f, setF] = useState({ nom: '', tel: '', mdp: '' });
  const [m, setM] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  if (user) return html`<div className="carte"><h2>Mon compte</h2><p><b>${profile.nom}</b><br /><span className="gris">📞 ${profile.tel}</span></p>
    <button className="btn plein-l gris-b" onClick=${async () => { await signOut(auth); go('/'); }}>Me déconnecter</button></div>`;
  const envoyer = async (e) => {
    e.preventDefault(); setM('');
    const d = normTel(f.tel);
    if (d.length !== 8) return setM('Numéro invalide : saisis les 8 chiffres (ex. 90 12 34 56).');
    setBusy(true);
    try {
      if (ins) {
        window.__ins = true;
        const c = await createUserWithEmailAndPassword(auth, telMail(d), f.mdp);
        await setDoc(doc(db, 'users', c.user.uid), { nom: f.nom.trim(), tel: d, email: telMail(d), role: 'acheteur', actif: true, createdAt: serverTimestamp() });
        window.__ins = false;
        await charger();
      } else await signInWithEmailAndPassword(auth, telMail(d), f.mdp);
      go('/');
    } catch (x) { window.__ins = false; if (auth.currentUser && ins) await signOut(auth).catch(() => {}); setM(erreur(x)); }
    setBusy(false);
  };
  return html`<form className="carte" onSubmit=${envoyer}><h2>${ins ? 'Créer mon compte' : 'Connexion'}</h2>
    ${ins && html`<label>Nom complet</label><input value=${f.nom} onChange=${set('nom')} required />`}
    <label>Numéro de téléphone</label><input type="tel" inputMode="numeric" placeholder="90 12 34 56" value=${f.tel} onChange=${set('tel')} required />
    <label>Mot de passe${ins ? ' (6 caractères min.)' : ''}</label><input type="password" minLength=${ins ? 6 : undefined} value=${f.mdp} onChange=${set('mdp')} required />
    ${(m || err) && html`<p className="alerte err">${m || err}</p>`}
    <button className="btn plein-l" disabled=${busy}>${busy ? 'Patiente…' : ins ? 'Créer mon compte' : 'Se connecter'}</button>
    <button type="button" className="lien" onClick=${() => { setIns(!ins); setM(''); }}>${ins ? "J'ai déjà un compte" : 'Pas de compte ? Créer un compte'}</button>
    <p className="gris" style=${{ marginTop: 10, fontSize: 13 }}>Mot de passe oublié ? Contacte le support DigiCom pour le réinitialiser.</p></form>`;
}

createRoot(document.getElementById('root')).render(html`<${App} />`);
