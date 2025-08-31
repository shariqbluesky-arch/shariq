
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { SafeAreaView, View, Text, TextInput, Pressable, FlatList, StyleSheet, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';

const DEFAULT_SYMBOLS = ['AAPL','MSFT','TSLA','GOOGL','AMZN','NVDA','RELIANCE.NS','TCS.NS','HDFCBANK.NS'];

const STORAGE_KEY = 'paper-trader-mobile-v1';

const currency = (n) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
};
const pct = (n) => `${(n * 100).toFixed(2)}%`;
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

const initialState = {
  cash: 10000,
  watchlist: DEFAULT_SYMBOLS.map(s => ({ symbol: s, price: 100 + Math.random() * 200 })),
  holdings: {}, // sym -> { qty, avg }
  history: [],  // {id,time,side,symbol,qty,price}
  settings: { refreshSecs: 8 },
};

async function saveState(state) {
  try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {}
}

async function loadState() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw);
    return { ...initialState, ...parsed };
  } catch {
    return initialState;
  }
}

function driftPrice(p, v = 0.015) {
  const change = (Math.random() * 2 - 1) * v;
  const np = p * (1 + change);
  return clamp(np, Math.max(1, p * 0.85), p * 1.15);
}

function priceMapFrom(watchlist) {
  const m = {};
  watchlist.forEach(w => m[w.symbol] = w.price);
  return m;
}

function pnlForSymbol(sym, holdings, priceMap) {
  const h = holdings[sym];
  if (!h) return { pnl: 0, change: 0 };
  const last = priceMap[sym] ?? 0;
  const pnl = (last - h.avg) * h.qty;
  const change = h.avg ? (last - h.avg) / h.avg : 0;
  return { pnl, change };
}

export default function App() {
  const [state, setState] = useState(initialState);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    (async () => {
      const s = await loadState();
      setState(s);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!ready) return;
    saveState(state);
  }, [state, ready]);

  useEffect(() => {
    if (!ready) return;
    const tick = () => {
      setState(prev => ({
        ...prev,
        watchlist: prev.watchlist.map(w => ({ ...w, price: driftPrice(w.price) }))
      }));
    };
    tick();
    const id = setInterval(tick, (state.settings.refreshSecs || 8) * 1000);
    return () => clearInterval(id);
  }, [ready, state.settings.refreshSecs]);

  const priceMap = useMemo(() => priceMapFrom(state.watchlist), [state.watchlist]);
  const equity = useMemo(() => Object.keys(state.holdings).reduce((sum, sym) => {
    const h = state.holdings[sym]; const p = priceMap[sym] ?? 0; return sum + h.qty * p;
  }, 0), [state.holdings, priceMap]);
  const total = state.cash + equity;

  const [symbol, setSymbol] = useState(state.watchlist[0]?.symbol || 'AAPL');
  const [qty, setQty] = useState('1');
  const [addSym, setAddSym] = useState('');

  const doTrade = (side) => {
    const q = Math.max(1, Math.floor(parseInt(qty || '1', 10)));
    const price = priceMap[symbol] ?? 0;
    if (!price) return;

    setState(prev => {
      const holdings = { ...prev.holdings };
      let cash = prev.cash;
      const history = [...prev.history];

      if (side === 'BUY') {
        const cost = q * price;
        if (cost > cash) { Alert.alert('Not enough cash'); return prev; }
        const h = holdings[symbol] || { qty: 0, avg: 0 };
        const newQty = h.qty + q;
        const newAvg = newQty ? (h.qty * h.avg + q * price) / newQty : price;
        holdings[symbol] = { qty: newQty, avg: newAvg };
        cash -= cost;
      } else {
        const h = holdings[symbol];
        if (!h || h.qty < q) { Alert.alert('Not enough shares'); return prev; }
        const remaining = h.qty - q;
        if (remaining === 0) delete holdings[symbol];
        else holdings[symbol] = { qty: remaining, avg: h.avg };
        cash += q * price;
      }

      history.unshift({ id: String(Date.now() + Math.random()), time: Date.now(), side, symbol, qty: q, price });
      return { ...prev, holdings, cash, history };
    });
  };

  const addSymbolToWatch = () => {
    const s = (addSym || '').trim().toUpperCase();
    if (!s) return;
    if (state.watchlist.find(w => w.symbol === s)) return;
    setState(prev => ({ ...prev, watchlist: [{ symbol: s, price: 100 + Math.random()*200 }, ...prev.watchlist] }));
    setAddSym('');
    setSymbol(s);
  };

  const removeSymbol = (sym) => {
    setState(prev => ({ ...prev, watchlist: prev.watchlist.filter(w => w.symbol !== sym) }));
  };

  const resetAll = () => {
    Alert.alert('Reset', 'Clear all data?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'OK', onPress: () => setState(initialState) }
    ]);
  };

  if (!ready) {
    return <SafeAreaView style={styles.container}><Text style={styles.h1}>Loading…</Text></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />
      <Text style={styles.h1}>Paper Trader (Mobile)</Text>
      <Text style={styles.caption}>Simulated trading with mock prices.</Text>

      <View style={styles.statsRow}>
        <Stat label="Total Value" value={currency(total)} />
        <Stat label="Cash" value={currency(state.cash)} />
        <Stat label="Invested" value={currency(equity)} />
      </View>

      <View style={styles.box}>
        <Text style={styles.sectionTitle}>Trade</Text>
        <View style={styles.row}>
          <TextInput
            value={symbol}
            onChangeText={setSymbol}
            placeholder="Symbol (e.g., AAPL)"
            style={styles.input}
            autoCapitalize="characters"
          />
          <TextInput
            value={qty}
            onChangeText={setQty}
            placeholder="Qty"
            keyboardType="numeric"
            style={styles.input}
          />
        </View>
        <View style={styles.row}>
          <Button title={`Buy`} onPress={() => doTrade('BUY')} />
          <View style={{ width: 8 }} />
          <Button title="Sell" onPress={() => doTrade('SELL')} danger />
        </View>
      </View>

      <View style={styles.box}>
        <Text style={styles.sectionTitle}>Watchlist</Text>
        <View style={styles.row}>
          <TextInput
            value={addSym}
            onChangeText={setAddSym}
            placeholder="Add symbol"
            style={styles.input}
            autoCapitalize="characters"
          />
          <Button title="Add" onPress={addSymbolToWatch} />
        </View>

        <FlatList
          data={state.watchlist}
          keyExtractor={(item) => item.symbol}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item }) => {
            const h = state.holdings[item.symbol];
            const { pnl, change } = pnlForSymbol(item.symbol, state.holdings, priceMap);
            const up = change >= 0;
            return (
              <View style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.symbol}>{item.symbol}</Text>
                  <Pressable onPress={() => removeSymbol(item.symbol)}>
                    <Text style={styles.remove}>✕</Text>
                  </Pressable>
                </View>
                <Text style={styles.price}>{currency(item.price)}</Text>
                <Text style={[styles.pnl, { color: up ? '#10b981' : '#ef4444' }]}>
                  {pct(change)} / {currency(pnl)} P&L
                </Text>
                {h && <Text style={styles.holding}>Holding: {h.qty} @ {currency(h.avg)}</Text>}
              </View>
            );
          }}
        />
      </View>

      <View style={styles.box}>
        <Text style={styles.sectionTitle}>Trade History</Text>
        {state.history.length === 0 ? (
          <Text style={styles.caption}>No trades yet.</Text>
        ) : (
          <FlatList
            data={state.history}
            keyExtractor={(t) => t.id}
            ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
            renderItem={({ item: t }) => (
              <View style={styles.historyRow}>
                <Text style={[styles.side, { color: t.side === 'BUY' ? '#10b981' : '#ef4444' }]}>{t.side}</Text>
                <Text style={styles.symSmall}>{t.symbol}</Text>
                <Text style={styles.qty}>×{t.qty}</Text>
                <Text style={styles.priceSmall}>{currency(t.price)}</Text>
                <Text style={styles.time}>{new Date(t.time).toLocaleString()}</Text>
              </View>
            )}
          />
        )}
      </View>

      <View style={{ height: 12 }} />
      <Button title="Reset All" onPress={resetAll} />
      <View style={{ height: 16 }} />
    </SafeAreaView>
  );
}

function Stat({ label, value }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function Button({ title, onPress, danger }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.btn, danger && styles.btnDanger, pressed && { opacity: 0.8 }]}>
      <Text style={styles.btnText}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#f8fafc' },
  h1: { fontSize: 22, fontWeight: '700' },
  caption: { color: '#64748b', marginBottom: 8 },
  statsRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  stat: { flex: 1, padding: 12, backgroundColor: '#fff', borderRadius: 14, elevation: 1 },
  statLabel: { fontSize: 12, color: '#64748b' },
  statValue: { fontSize: 16, fontWeight: '700', marginTop: 4 },
  box: { backgroundColor: '#fff', borderRadius: 16, padding: 12, marginTop: 12, elevation: 1 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, paddingHorizontal: 12, height: 44, backgroundColor: '#fff' },
  card: { padding: 12, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  symbol: { fontSize: 16, fontWeight: '700' },
  remove: { fontSize: 16, color: '#94a3b8' },
  price: { fontSize: 18, fontWeight: '700', marginTop: 6 },
  pnl: { marginTop: 2 },
  holding: { color: '#64748b', marginTop: 4 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  side: { width: 48, fontWeight: '700' },
  symSmall: { width: 80, fontWeight: '600' },
  qty: { width: 50 },
  priceSmall: { width: 90 },
  time: { flex: 1, color: '#64748b' },
  btn: { backgroundColor: '#111827', paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnDanger: { backgroundColor: '#ef4444' },
  btnText: { color: '#fff', fontWeight: '700' },
});
