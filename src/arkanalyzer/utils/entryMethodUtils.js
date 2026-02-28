"use strict";
/*
 * Copyright (c) 2024 Huawei Device Co., Ltd.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.addCfg2Stmt = exports.getCallbackMethodFromStmt = exports.COMPONENT_LIFECYCLE_METHOD_NAME = exports.CALLBACK_METHOD_NAME = exports.LIFECYCLE_METHOD_NAME = void 0;
const Type_1 = require("../core/base/Type");
exports.LIFECYCLE_METHOD_NAME = [
    'onCreate',
    'onDestroy',
    'onWindowStageCreate',
    'onWindowStageDestroy',
    'onForeground',
    'onBackground',
    'onBackup',
    'onRestore',
    'onContinue',
    'onNewWant',
    'onDump',
    'onSaveState',
    'onShare',
    'onPrepareToTerminate',
    'onBackPressed',
    'onSessionCreate',
    'onSessionDestory',
    'onAddForm',
    'onCastToNormalForm',
    'onUpdateForm',
    'onChangeFormVisibility',
    'onFormEvent',
    'onRemoveForm',
    'onConfigurationUpdate',
    'onAcquireFormState',
    'onWindowStageWillDestroy',
];
exports.CALLBACK_METHOD_NAME = [
    "onClick",
    "onTouch",
    "onAppear",
    "onDisAppear",
    "onDragStart",
    "onDragEnter",
    "onDragMove",
    "onDragLeave",
    "onDrop",
    "onKeyEvent",
    "onFocus",
    "onBlur",
    "onHover",
    "onMouse",
    "onAreaChange",
    "onVisibleAreaChange", // 组件可见区域变化事件，组件在屏幕中的显示区域面积变化时触发
];
exports.COMPONENT_LIFECYCLE_METHOD_NAME = [
    'build',
    'aboutToAppear',
    'aboutToDisappear',
    'aboutToReuse',
    'aboutToRecycle',
    'onWillApplyTheme',
    'onLayout',
    'onPlaceChildren',
    'onMeasure',
    'onMeasureSize',
    'onPageShow',
    'onPageHide',
    'onFormRecycle',
    'onFormRecover',
    'onBackPress',
    'pageTransition',
    'onDidBuild'
];
function getCallbackMethodFromStmt(stmt, scene) {
    const invokeExpr = stmt.getInvokeExpr();
    if (invokeExpr && invokeExpr.getMethodSignature().getDeclaringClassSignature().getClassName() === '' && exports.CALLBACK_METHOD_NAME.includes(invokeExpr.getMethodSignature().getMethodSubSignature().getMethodName())) {
        for (const arg of invokeExpr.getArgs()) {
            const argType = arg.getType();
            if (argType instanceof Type_1.FunctionType) {
                const cbMethod = scene.getMethod(argType.getMethodSignature());
                if (cbMethod) {
                    return cbMethod;
                }
            }
        }
    }
    return null;
}
exports.getCallbackMethodFromStmt = getCallbackMethodFromStmt;
function addCfg2Stmt(method) {
    const cfg = method.getCfg();
    if (cfg) {
        for (const block of cfg.getBlocks()) {
            for (const stmt of block.getStmts()) {
                stmt.setCfg(cfg);
            }
        }
    }
}
exports.addCfg2Stmt = addCfg2Stmt;
