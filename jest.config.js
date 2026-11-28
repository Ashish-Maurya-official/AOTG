module.exports = {
  preset: '@react-native/jest-preset',
  // Redux dependencies expose ESM builds under React Native's export conditions.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@reduxjs|react-redux|redux|redux-thunk|immer|reselect)/)',
  ],
};
