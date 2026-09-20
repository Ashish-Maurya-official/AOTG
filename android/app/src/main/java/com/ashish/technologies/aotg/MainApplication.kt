package com.ashish.technologies.aotg

import android.app.Application
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.ashish.technologies.aotg.turbo_modules.llm.LLMPackage
import com.ashish.technologies.aotg.turbo_modules.accessibility.AccessibilityPackage
import com.ashish.technologies.aotg.turbo_modules.document.DocumentProcessorPackage

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          // add(MyReactNativePackage())
          add(LLMPackage())
          add(AccessibilityPackage())
          add(DocumentProcessorPackage())
        },
    )
  }

  override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
  }
}
