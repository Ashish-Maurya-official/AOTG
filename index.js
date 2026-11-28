/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
AppRegistry.registerHeadlessTask('AOTGAgentTask', () => async ({taskId}) => {
  const {agentRuntime} = require('./src/agents/agentRuntime');
  await agentRuntime.run(taskId);
});
