package io.github.revenge.themes

import de.robv.android.xposed.XC_MethodHook
import de.robv.android.xposed.XposedBridge
import java.lang.reflect.Member

internal inline fun Member.hookBefore(
    crossinline block: XC_MethodHook.MethodHookParam.() -> Unit,
): XC_MethodHook.Unhook = XposedBridge.hookMethod(this, object : XC_MethodHook() {
    override fun beforeHookedMethod(param: MethodHookParam) = param.block()
})

internal inline fun Member.hookAfter(
    crossinline block: XC_MethodHook.MethodHookParam.() -> Unit,
): XC_MethodHook.Unhook = XposedBridge.hookMethod(this, object : XC_MethodHook() {
    override fun afterHookedMethod(param: MethodHookParam) = param.block()
})
