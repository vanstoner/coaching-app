import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

// Slice 0a is the walking skeleton: this screen is deliberately static.
//
// It imports nothing from src/engine or src/types, holds no state, and runs no
// timer. The clock face below is a fixed string, not a rendering of elapsed
// time — wiring it to the real engine is Slice 0b. Invariant 2 (elapsed time
// comes from wall-clock anchors, never tick counting) is why there is no
// setInterval here even for decoration: a decorative ticker is a pattern that
// gets copied.
export default function App() {
  return (
    <View style={styles.container}>
      {/* Placeholder squad name. Not a real club, and no real squad data ships
          in this repository — see CLAUDE.md, Data protection. */}
      <Text style={styles.squad}>Example FC</Text>

      {/* Placeholder clock face. Static by PO ruling (issue #11, 2026-09-17). */}
      <Text style={styles.clock}>00:00</Text>

      <Text style={styles.caption}>Slice 0a — walking skeleton</Text>
      <Text style={styles.caption}>The clock is a placeholder and does not run.</Text>

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b3d2e',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  squad: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 8,
  },
  clock: {
    color: '#ffffff',
    fontSize: 72,
    fontVariant: ['tabular-nums'],
    marginBottom: 24,
  },
  caption: {
    color: '#cfe3da',
    fontSize: 14,
    textAlign: 'center',
  },
});
