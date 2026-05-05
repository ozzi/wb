function makePoolFiltrationController(
    name,
    pumpSwitchTopicName,
    buttonSinglePressTopicName,
    buttonLongPressTopicName,
    flowSensorTopicName
) {
    var deviceName = "pool-filtration-ctrl-" + name;

    defineVirtualDevice(deviceName, {
        title: "Pool Filtration Controller - " + name,
        cells: {
            mode: {
                title: "mode",
                type: "value",
                value: 0,
                readonly: true,
                enum: {
                    0: { en: "Idle",         ru: "Ожидание" },
                    1: { en: "Run",          ru: "Фильтрация" },
                    2: { en: "Service Wait", ru: "Ожидание обслуживания" },
                    3: { en: "Fault",        ru: "Ошибка" },
                    4: { en: "Backwash",     ru: "Промывка" },
                    5: { en: "Rinse",        ru: "Уплотнение" }
                }
            },
            flow_check_delay: {
                title: "flow check delay",
                type: "value",
                unit: "с",
                value: 30,
                readonly: false
            },
            backwash_duration: {
                title: "backwash duration",
                type: "value",
                unit: "с",
                value: 180,
                readonly: false
            },
            rinse_duration: {
                title: "rinse duration",
                type: "value",
                unit: "с",
                value: 45,
                readonly: false
            },
            intent_start: {
                title: "START",
                type: "pushbutton"
            },
            intent_stop: {
                title: "STOP",
                type: "pushbutton"
            },
            intent_service: {
                title: "SERVICE",
                type: "pushbutton"
            },
            intent_backwash_start: {
                title: "BACKWASH START",
                type: "pushbutton"
            },
            intent_rinse_start: {
                title: "RINSE START",
                type: "pushbutton"
            },
            intent_emergency_stop: {
                title: "EMERGENCY STOP",
                type: "pushbutton"
            },
            intent_reset: {
                title: "RESET",
                type: "pushbutton"
            }
        }
    });

    var modeTopicName = deviceName + "/mode";
    var flowCheckDelayTopicName = deviceName + "/flow_check_delay";
    var backwashDurationTopicName = deviceName + "/backwash_duration";
    var rinseDurationTopicName = deviceName + "/rinse_duration";
    var intentStartTopicName = deviceName + "/intent_start";
    var intentStopTopicName = deviceName + "/intent_stop";
    var intentServiceTopicName = deviceName + "/intent_service";
    var intentBackwashStartTopicName = deviceName + "/intent_backwash_start";
    var intentRinseStartTopicName = deviceName + "/intent_rinse_start";
    var intentEmergencyStopTopicName = deviceName + "/intent_emergency_stop";
    var intentResetTopicName = deviceName + "/intent_reset";

    var flowCheckTimer = null;
    var backwashTimer = null;
    var rinseTimer = null;

    function cancelFlowCheckTimer() {
        if (flowCheckTimer !== null) {
            clearTimeout(flowCheckTimer);
            flowCheckTimer = null;
        }
    }

    function cancelBackwashTimer() {
        if (backwashTimer !== null) {
            clearTimeout(backwashTimer);
            backwashTimer = null;
        }
    }

    function cancelRinseTimer() {
        if (rinseTimer !== null) {
            clearTimeout(rinseTimer);
            rinseTimer = null;
        }
    }

    function startFlowCheckTimer() {
        cancelFlowCheckTimer();
        var delay = dev[flowCheckDelayTopicName];
        if (!delay || delay <= 0) { delay = 30; }
        flowCheckTimer = setTimeout(function () {
            flowCheckTimer = null;
            var mode = dev[modeTopicName];
            if (mode !== 1) { return; }
            var hasFlow = dev[flowSensorTopicName];
            if (!hasFlow) {
                log.warning("[pool-filtration-ctrl-{}] no flow detected after {}s — going to fault", name, delay);
                dev[modeTopicName] = 3;
            }
        }, delay * 1000);
    }

    function applyMode(newMode) {
        cancelFlowCheckTimer();
        cancelBackwashTimer();
        cancelRinseTimer();

        dev[modeTopicName] = newMode;

        if (newMode === 0 || newMode === 2 || newMode === 3) {
            if (dev[pumpSwitchTopicName] !== false) {
                dev[pumpSwitchTopicName] = false;
            }
        } else if (newMode === 1) {
            if (dev[pumpSwitchTopicName] !== true) {
                dev[pumpSwitchTopicName] = true;
            }
            if (flowSensorTopicName) {
                startFlowCheckTimer();
            }
        } else if (newMode === 4) {
            if (dev[pumpSwitchTopicName] !== true) {
                dev[pumpSwitchTopicName] = true;
            }
            var bDuration = dev[backwashDurationTopicName];
            if (!bDuration || bDuration <= 0) { bDuration = 180; }
            backwashTimer = setTimeout(function () {
                backwashTimer = null;
                applyMode(2);
            }, bDuration * 1000);
        } else if (newMode === 5) {
            if (dev[pumpSwitchTopicName] !== true) {
                dev[pumpSwitchTopicName] = true;
            }
            var rDuration = dev[rinseDurationTopicName];
            if (!rDuration || rDuration <= 0) { rDuration = 45; }
            rinseTimer = setTimeout(function () {
                rinseTimer = null;
                applyMode(1);
            }, rDuration * 1000);
        }
    }

    defineRule("intent-start-" + name, {
        whenChanged: [intentStartTopicName],
        then: function () {
            var mode = dev[modeTopicName];
            if (mode === 0 || mode === 3) {
                applyMode(1);
            }
        }
    });

    defineRule("intent-stop-" + name, {
        whenChanged: [intentStopTopicName],
        then: function () {
            var mode = dev[modeTopicName];
            if (mode === 1 || mode === 2) {
                applyMode(0);
            }
        }
    });

    defineRule("intent-service-" + name, {
        whenChanged: [intentServiceTopicName],
        then: function () {
            var mode = dev[modeTopicName];
            if (mode === 0 || mode === 1) {
                applyMode(2);
            }
        }
    });

    defineRule("intent-backwash-start-" + name, {
        whenChanged: [intentBackwashStartTopicName],
        then: function () {
            var mode = dev[modeTopicName];
            if (mode === 2) {
                applyMode(4);
            }
        }
    });

    defineRule("intent-rinse-start-" + name, {
        whenChanged: [intentRinseStartTopicName],
        then: function () {
            var mode = dev[modeTopicName];
            if (mode === 2) {
                applyMode(5);
            }
        }
    });

    defineRule("intent-emergency-stop-" + name, {
        whenChanged: [intentEmergencyStopTopicName],
        then: function () {
            applyMode(3);
        }
    });

    defineRule("intent-reset-" + name, {
        whenChanged: [intentResetTopicName],
        then: function () {
            var mode = dev[modeTopicName];
            if (mode === 3) {
                applyMode(0);
            }
        }
    });

    defineRule("pump-switch-changed-" + name, {
        whenChanged: [pumpSwitchTopicName],
        then: function (newValue) {
            var mode = dev[modeTopicName];
            if (newValue == false) {
                if (mode === 1 || mode === 4 || mode === 5) {
                    applyMode(0);
                }
            } else if (newValue == true) {
                if (mode === 0 || mode === 3) {
                    applyMode(1);
                }
            }
        }
    });

    if (flowSensorTopicName) {
        defineRule("flow-lost-" + name, {
            whenChanged: [flowSensorTopicName],
            then: function (newValue) {
                var mode = dev[modeTopicName];
                if (mode !== 1) { return; }
                if (newValue === false) {
                    startFlowCheckTimer();
                } else {
                    cancelFlowCheckTimer();
                }
            }
        });
    }

    if (buttonLongPressTopicName) {
        defineRule("long-press-" + name, {
            whenChanged: [buttonLongPressTopicName],
            then: function () {
                var mode = dev[modeTopicName];
                if (mode === 1 || mode === 0) {
                    applyMode(2);
                } else if (mode === 2) {
                    applyMode(0);
                }
            }
        });
    }

    if (buttonSinglePressTopicName) {
        defineRule("single-press-" + name, {
            whenChanged: [buttonSinglePressTopicName],
            then: function () {
                var mode = dev[modeTopicName];
                if (mode === 0 || mode === 3) {
                    applyMode(1);
                } else if (mode === 1) {
                    applyMode(0);
                } else if (mode === 2) {
                    applyMode(4);
                }
            }
        });
    }

    return {
        modeTopicName: modeTopicName
    };
}

// --- Точка входа ---

var ctrl = makePoolFiltrationController(
    "outdoor",
    "wb-mr6cu_91/K1",
    "wb-mcm8_238/Input 3 Single Press Counter",
    "wb-mcm8_238/Input 3 Long Press Counter",
    "wb-mcm8_238/Input 2"
);
