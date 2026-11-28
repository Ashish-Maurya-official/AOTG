package com.ashish.technologies.aotg.turbo_modules.agenttools

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class AgentToolsPackage : BaseReactPackage() {
    override fun getModule(name: String, context: ReactApplicationContext): NativeModule? =
        if (name == AgentToolsModule.NAME) AgentToolsModule(context) else null

    override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
        mapOf(AgentToolsModule.NAME to ReactModuleInfo(AgentToolsModule.NAME,
            AgentToolsModule::class.java.name, false, false, false, true))
    }
}
