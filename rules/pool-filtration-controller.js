function makePoolFiltrationController(
    name,
    pumpSwitchTopicName,
    buttonTopicName,
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
                readonly: false,
                enum: {
                    0: { en: "Off",       ru: "Выключено" },
                    1: { en: "Filtration", ru: "Фильтрация" },
                    2: { en: "Backwash",  ru: "Обратная промывка" },
                    3: { en: "Fault",     ru: "Ошибка" }
                }
            },
            flow_check_delay: {
                title: "flow check delay",
                type: "value",
                unit: "с",
                value: 30,
                readonly: false
            }
        }
    });

    var modeTopicName = deviceName + "/mode";
    var flowCheckDelayTopicName = deviceName + "/flow_check_delay";

    var flowCheckTimer = null;

    function cancelFlowCheckTimer() {
        if (flowCheckTimer !== null) {
            clearTimeout(flowCheckTimer);
            flowCheckTimer = null;
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

    defineRule("mode-changed-" + name, {
        whenChanged: [modeTopicName],
        then: function (newValue) {
            cancelFlowCheckTimer();
            if (newValue == 0 || newValue == 2 || newValue == 3) {
                if (dev[pumpSwitchTopicName] !== false) {
                    dev[pumpSwitchTopicName] = false;
                }
            } else if (newValue == 1) {
                if (dev[pumpSwitchTopicName] !== true) {
                    dev[pumpSwitchTopicName] = true;
                }
                if (flowSensorTopicName) {
                    startFlowCheckTimer();
                }
            }
        }
    });

    defineRule("pump-switch-changed-" + name, {
        whenChanged: [pumpSwitchTopicName],
        then: function (newValue) {
            var mode = dev[modeTopicName];
            if (newValue == false) {
                if (mode == 1) {
                    dev[modeTopicName] = 0;
                }
            } else if (newValue == true) {
                if (mode == 0 || mode == 3) {
                    dev[modeTopicName] = 1;
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
                    // Проток пропал во время фильтрации — запускаем таймер
                    startFlowCheckTimer();
                } else {
                    // Проток появился — сбрасываем таймер
                    cancelFlowCheckTimer();
                }
            }
        });
    }

    if (buttonTopicName) {
        defineRule("backwash-long-press-" + name, {
            whenChanged: [buttonTopicName + "/Long Press Counter"],
            then: function () {
                var mode = dev[modeTopicName];
                if (mode == 2) {
                    dev[modeTopicName] = 1;
                } else {
                    dev[modeTopicName] = 2;
                }
            }
        });

        defineRule("backwash-single-press-" + name, {
            whenChanged: [buttonTopicName + "/Single Press Counter"],
            then: function () {
                var mode = dev[modeTopicName];
                if (mode == 2) {
                    dev[pumpSwitchTopicName] = !dev[pumpSwitchTopicName];
                } else if (mode == 1) {
                    dev[modeTopicName] = 0;
                } else if (mode == 0) {
                    dev[modeTopicName] = 1;
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
    "wb-mcm8_238/Input 3",
    "wb-mcm8_238/Input 2"
);
