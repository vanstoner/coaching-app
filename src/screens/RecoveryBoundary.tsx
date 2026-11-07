/**
 * #176: one render exception no longer closes the app. A screen that throws
 * while drawing is replaced by a calm recovery screen (Dee's prototype, Rob
 * 7 Nov). It shows no error text and sends nothing anywhere (C3), and it
 * changes nothing stored (C6): Go to Home only moves the screen.
 *
 * It catches what React can: an exception while a screen renders. A throw in
 * a tap, a timer or a promise is outside any boundary's reach (Bea's
 * out-of-scope note on #176).
 */

import { Component, type ReactNode } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { recoveryCopy, takeRecoveryTest, type RecoveryWhere } from '../app/recovery';
import { Action, Icon, MainButton, MainFoot } from './controls';
import { BuildLabel } from './BuildLabel';
import { colours, screen } from './theme';

/** Throws once when the Test kit armed it (C11); draws nothing otherwise. */
export function RecoveryProbe(): null {
  if (takeRecoveryTest()) throw new Error('Test kit: the next screen fails');
  return null;
}

interface Props {
  where: RecoveryWhere;
  /** Go to Home, Go to Settings, or (the shell) Try again. */
  onMain: () => void;
  /** Export minutes file, when this phone's record is loaded. */
  onExport?: () => void;
  children: ReactNode;
}

export class RecoveryBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  private back: { remove: () => void } | null = null;

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidUpdate(): void {
    // #175 C10: Back on the recovery screen does what its Main button does;
    // on the shell's it keeps Android's default.
    if (this.state.failed && this.props.where !== 'shell' && !this.back) {
      this.back = BackHandler.addEventListener('hardwareBackPress', () => {
        this.leave();
        return true;
      });
    }
    if (!this.state.failed && this.back) {
      this.back.remove();
      this.back = null;
    }
  }

  componentWillUnmount(): void {
    this.back?.remove();
  }

  private leave = () => {
    this.props.onMain();
    this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    const copy = recoveryCopy(this.props.where, this.props.onExport !== undefined);
    return (
      <View style={screen.flex}>
        <View style={local.calm}>
          <View style={local.badge}>
            <Icon name="lifebuoy" size={38} color={colours.action} />
          </View>
          <Text style={local.title}>{copy.title}</Text>
          {copy.lines.map((line) => (
            <Text key={line} style={local.line}>
              {line}
            </Text>
          ))}
        </View>
        <MainFoot>
          <MainButton label={copy.main} onPress={this.leave} />
          {copy.offerExport && this.props.onExport && (
            <>
              <Action label="Export minutes file" onPress={this.props.onExport} />
              <Text style={screen.hint}>A copy of your record, to keep somewhere safe.</Text>
            </>
          )}
          <BuildLabel />
        </MainFoot>
      </View>
    );
  }
}

const local = StyleSheet.create({
  calm: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  badge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colours.pitchRaised,
    borderWidth: 2,
    borderColor: colours.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: { color: colours.ink, fontSize: 24, fontWeight: '700', textAlign: 'center', alignSelf: 'stretch', includeFontPadding: false },
  line: { color: colours.inkMuted, fontSize: 16, textAlign: 'center', alignSelf: 'stretch', marginTop: 10, includeFontPadding: false },
});
