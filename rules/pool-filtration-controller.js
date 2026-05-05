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
            intent: {
                title: "intent",
                type: "text",
                value: "",
                readonly: false
            }
        }
    });

    var modeTopicName = deviceName + "/mode";
    var flowCheckDelayTopicName = deviceName + "/flow_check_delay";
    var backwashDurationTopicName = deviceName + "/backwash_duration";
    var rinseDurationTopicName = deviceName + "/rinse_duration";
    var intentTopicName = deviceName + "/intent";

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

    defineRule("intent-changed-" + name, {
        whenChanged: [intentTopicName],
        then: function (newValue) {
            if (newValue === "") { return; }
            dev[intentTopicName] = "";

            var mode = dev[modeTopicName];

            if (newValue === "START") {
                if (mode === 0 || mode === 3) {
                    applyMode(1);
                }
            } else if (newValue === "STOP") {
                if (mode === 1 || mode === 2) {
                    applyMode(0);
                }
            } else if (newValue === "SERVICE") {
                if (mode === 1 || mode === 0) {
                    applyMode(2);
                }
            } else if (newValue === "BACKWASH_START") {
                if (mode === 2) {
                    applyMode(4);
                }
            } else if (newValue === "RINSE_START") {
                if (mode === 2) {
                    applyMode(5);
                }
            } else if (newValue === "EMERGENCY_STOP") {
                applyMode(3);
            } else if (newValue === "RESET") {
                if (mode === 3) {
                    applyMode(0);
                }
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
