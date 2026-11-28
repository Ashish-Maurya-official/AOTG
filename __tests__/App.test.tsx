/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {Platform} from 'react-native';
import App from '../App';
import {agentRuntime} from '../src/agents/agentRuntime';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null), setItem: jest.fn().mockResolvedValue(undefined),
}));
// Screen-specific native modules are covered in their service tests.
jest.mock('../src/screens/HomePage/HomePage', () => 'HomePage');
jest.mock('../src/screens/AgentPage/AgentPage', () => 'AgentPage');
jest.mock('../src/screens/SettingsPage/SettingsPage', () => 'SettingsPage');
jest.mock('../src/agents/agentRuntime', () => ({agentRuntime: {restore: jest.fn().mockResolvedValue(undefined)}}));

test.each(['android', 'ios'] as const)('renders and restores tasks only on Android (%s)', async platform => {
  const originalPlatform = Platform.OS;
  Platform.OS = platform;
  jest.mocked(agentRuntime.restore).mockClear();
  let app: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    app = ReactTestRenderer.create(<App />);
  });
  expect(agentRuntime.restore).toHaveBeenCalledTimes(platform === 'android' ? 1 : 0);
  await ReactTestRenderer.act(async () => { app?.unmount(); });
  Platform.OS = originalPlatform;
});
