package com.ashish.technologies.aotg

import android.view.KeyEvent
import com.github.kevinejohn.keyevent.KeyEventModule

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "AOTG"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  /**
   * dispatchKeyEvent fires before onKeyDown and gives us first shot at
   * consuming key combinations before the system processes them.
   */
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    // Forward every key event to react-native-keyevent
    if (event.action == KeyEvent.ACTION_DOWN) {
      KeyEventModule.getInstance().onKeyDownEvent(event.keyCode, event)
    } else if (event.action == KeyEvent.ACTION_UP) {
      KeyEventModule.getInstance().onKeyUpEvent(event.keyCode, event)
    }

    // Consume bare Enter (without Shift) so TextInput doesn't insert a newline
    if (event.action == KeyEvent.ACTION_DOWN &&
        event.keyCode == KeyEvent.KEYCODE_ENTER &&
        !event.isShiftPressed) {
      return true
    }

    // Consume Ctrl+N and Ctrl+M to prevent system from handling them
    if (event.isCtrlPressed) {
      when (event.keyCode) {
        KeyEvent.KEYCODE_N, KeyEvent.KEYCODE_M -> return true
      }
    }

    return super.dispatchKeyEvent(event)
  }
}
