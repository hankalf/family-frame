import { Component } from 'react';

/**
 * Contains a crash to one part of the kiosk. Without this, a throw inside the
 * radar map would unmount the whole React tree and leave a wall-mounted screen
 * blank until someone reboots it.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('[kiosk] contained render error:', error);
  }

  render() {
    if (this.state.failed) return this.props.fallback ?? null;
    return this.props.children;
  }
}
