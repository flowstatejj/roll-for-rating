import { Component, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Sentry, sentryEnabled } from '@/lib/sentry';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Catches render-phase crashes anywhere below it so a broken screen shows a
 * readable, copyable error instead of silently closing the whole app. The app
 * had no error boundary before, which is why a screen crash took the process
 * down with nothing to show for it. The error text is also reported to Sentry.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (sentryEnabled) Sentry.captureException(error);
    // eslint-disable-next-line no-console
    console.error('AppErrorBoundary caught:', error);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <ScrollView
        style={{ flex: 1, backgroundColor: '#0d0d0f' }}
        contentContainerStyle={{ padding: 24, paddingTop: 72, gap: 12 }}>
        <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800' }}>Something went wrong</Text>
        <Text style={{ color: '#bbb', fontSize: 13 }}>
          This screen hit an error. Please screenshot this and send it over so it can be fixed.
        </Text>
        <Text selectable style={{ color: '#ff8a8a', fontSize: 14, fontWeight: '700', marginTop: 8 }}>
          {error.name}: {error.message}
        </Text>
        <Text selectable style={{ color: '#8a8a94', fontSize: 11, lineHeight: 16 }}>
          {(error.stack ?? '').slice(0, 2000)}
        </Text>
        <Pressable
          onPress={this.reset}
          style={{ marginTop: 16, alignSelf: 'flex-start', backgroundColor: '#3a7afe', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 999 }}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>Try again</Text>
        </Pressable>
      </ScrollView>
    );
  }
}
