function findTargetTemperature(currentPerformancePreset, presets) {
    var filteredPresets = presets.filter(function(pair) {
        return pair[0] !== 0 && pair[1] !== 0 && pair[2] !== 0;
    });

    if (filteredPresets.length === 0) {
        return null;
    }

    filteredPresets.sort(function(a, b) {
        return a[0] - b[0];
    });

    for (var i = 0; i < filteredPresets.length; i++) {
        if (filteredPresets[i][0] >= currentPerformancePreset) {
            return filteredPresets[i];
        }
    }

    return filteredPresets[filteredPresets.length - 1];
}

function isASICWork(status) {
    return (status == "mining" ||
        status == "initializing" ||
        status == "starting" ||
        status == "auto-tuning" ||
        status == "restarting" ||
        status == "shutting-down"
    );
}

function isASICOffWork(status) {
    return (status == "stopped" ||
        status == "failure"
    );
}

function makeASICCoolingController(
    name,
    outdoorTemperatureTopicName,
    dryCoolingSetTemperatureCallback,
    wellCoolingSetTemperatureCallback,
    poolCoolingSetTemperatureCallback,
    dryCoolingRunCallback,
    wellCoolingRunCallback,
    poolCoolingRunCallback,
    firstASICPerformancePresetTopicName,
    firstASICStateTopicName,
    secondASICPerformancePresetTopicName,
    secondASICStateTopicName,
    poolHeatActiveTopicName
) {
    var deviceName = "ASIC-cooling-controller-" + name;
    defineVirtualDevice(deviceName, {
        title: "ASIC Cooling Controller - " + name,
        cells: {
            mode: {
                title: "mode",
                type: "value",
                value: 2,
                readonly: false,
                enum: {
                    0: { en: "Off", ru: "Выключено" },
                    1: { en: "Auto", ru: "Автоматический выбор" },
                    2: { en: "Dry cooling", ru: "Сухая градирня" },
                    3: { en: "Well cooling", ru: "Скважинное охлаждение" },
                    4: { en: "Pool cooling", ru: "Охлаждение бассейном" }
                }
            },
            target_temperature: {
                title: "Target temperature",
                type: "value",
                value: 35,
                readonly: false
            },
            switch_temperature: {
                title: "Delta inlet water - outdoor air for auto mode",
                type: "value",
                value: 20,
                readonly: false
            },
            use_performance_preset: {
                title: "tune inlet water by performance preset",
                type: "switch",
                value: false,
                readonly: false
            },
            current_performance_preset: {
                title: "current performance preset",
                type: "value",
                value: 0,
                readonly: true
            },
            performance_preset_1: {
                title: "performance preset 1",
                type: "value",
                value: 0,
                readonly: false
            },
            target_temperature_1: {
                title: "Target temperature for preset 1",
                type: "value",
                value: 0,
                readonly: false
            },
            switch_temperature_1: {
                title: "Delta water - air for preset 1",
                type: "value",
                value: 20,
                readonly: false
            },
            performance_preset_2: {
                title: "performance preset 2",
                type: "value",
                value: 0,
                readonly: false
            },
            target_temperature_2: {
                title: "Target temperature for preset 2",
                type: "value",
                value: 0,
                readonly: false
            },
            switch_temperature_2: {
                title: "Delta water - air for preset 2",
                type: "value",
                value: 20,
                readonly: false
            },
            performance_preset_3: {
                title: "performance preset 3",
                type: "value",
                value: 0,
                readonly: false
            },
            target_temperature_3: {
                title: "Target temperature for preset 3",
                type: "value",
                value: 0,
                readonly: false
            },
            switch_temperature_3: {
                title: "Delta water - air for preset 3",
                type: "value",
                value: 20,
                readonly: false
            },
            performance_preset_4: {
                title: "performance preset 4",
                type: "value",
                value: 0,
                readonly: false
            },
            switch_temperature_4: {
                title: "Delta water - air for preset 4",
                type: "value",
                value: 20,
                readonly: false
            },
            target_temperature_4: {
                title: "Target temperature for preset 4",
                type: "value",
                value: 0,
                readonly: false
            },
            performance_preset_5: {
                title: "performance preset 5",
                type: "value",
                value: 0,
                readonly: false
            },
            target_temperature_5: {
                title: "Target temperature for preset 5",
                type: "value",
                value: 0,
                readonly: false
            },
            switch_temperature_5: {
                title: "Delta water - air for preset 5",
                type: "value",
                value: 20,
                readonly: false
            },
        }
    });

    var modeTopicName = deviceName + "/mode";
    var targetTemperatureTopicName = deviceName + "/target_temperature";
    var switchTemperatureTopicName = deviceName + "/switch_temperature";
    var usePerformancePresetTopicName = deviceName + "/use_performance_preset";
    var currentPerformancePresetTopicName = deviceName + "/current_performance_preset";
    var performancePreset1TopicName = deviceName + "/performance_preset_1";
    var targetTemperature1TopicName = deviceName + "/target_temperature_1";
    var switchTemperature1TopicName = deviceName + "/switch_temperature_1";
    var performancePreset2TopicName = deviceName + "/performance_preset_2";
    var targetTemperature2TopicName = deviceName + "/target_temperature_2";
    var switchTemperature2TopicName = deviceName + "/switch_temperature_2";
    var performancePreset3TopicName = deviceName + "/performance_preset_3";
    var targetTemperature3TopicName = deviceName + "/target_temperature_3";
    var switchTemperature3TopicName = deviceName + "/switch_temperature_3";
    var performancePreset4TopicName = deviceName + "/performance_preset_4";
    var targetTemperature4TopicName = deviceName + "/target_temperature_4";
    var switchTemperature4TopicName = deviceName + "/switch_temperature_4";
    var performancePreset5TopicName = deviceName + "/performance_preset_5";
    var targetTemperature5TopicName = deviceName + "/target_temperature_5";
    var switchTemperature5TopicName = deviceName + "/switch_temperature_5";

    defineRule("asic-cooling-controller-mode-" + name, {
        whenChanged: [
            modeTopicName
        ],
        then: function (newValue) {
            log("asic cooling change mode to " + newValue);
            if (newValue == 0) {
                dryCoolingRunCallback(false);
                wellCoolingRunCallback(false);
                poolCoolingRunCallback(false);
            } else if (newValue == 1) {
                poolCoolingRunCallback(false);
                var outdoorTemperature = dev[outdoorTemperatureTopicName];
                var switchTemperature = dev[switchTemperatureTopicName];
                var targetTemperature = dev[targetTemperatureTopicName];
                if (outdoorTemperature === null || outdoorTemperature === undefined ||
                    switchTemperature === null || switchTemperature === undefined ||
                    targetTemperature === null || targetTemperature === undefined) {
                    log("asic cooling mode 1: skipping, topics not ready");
                    return;
                }
                var delta = targetTemperature - outdoorTemperature;
                if (delta < switchTemperature) {
                    dryCoolingRunCallback(false);
                    wellCoolingRunCallback(true);
                } else {
                    wellCoolingRunCallback(false);
                    dryCoolingRunCallback(true);
                }
            } else if (newValue == 2) {
                wellCoolingRunCallback(false);
                poolCoolingRunCallback(false);
                dryCoolingRunCallback(true);
            } else if (newValue == 3) {
                dryCoolingRunCallback(false);
                poolCoolingRunCallback(false);
                wellCoolingRunCallback(true);
            } else if (newValue == 4) {
                dryCoolingRunCallback(false);
                wellCoolingRunCallback(false);
                poolCoolingRunCallback(true);
            }
        }
    });

    defineRule("asic-cooling-controller-switch-" + name, {
        whenChanged: [
            switchTemperatureTopicName,
            outdoorTemperatureTopicName,
            targetTemperatureTopicName
        ],
        then: function () {
            if (dev[modeTopicName] != 1) {
                return;
            }
            var outdoorTemperature = dev[outdoorTemperatureTopicName];
            var switchTemperature = dev[switchTemperatureTopicName];
            var targetTemperature = dev[targetTemperatureTopicName];
            if (outdoorTemperature === null || outdoorTemperature === undefined ||
                switchTemperature === null || switchTemperature === undefined ||
                targetTemperature === null || targetTemperature === undefined) {
                log("asic cooling switch: skipping, topics not ready");
                return;
            }
            var hysteresis = 0.25;
            var delta = targetTemperature - outdoorTemperature;
            if (delta < (switchTemperature - hysteresis)) {
                dryCoolingRunCallback(false);
                wellCoolingRunCallback(true);
            } else if (delta > (switchTemperature + hysteresis)) {
                wellCoolingRunCallback(false);
                dryCoolingRunCallback(true);
            }
        }
    });

    defineRule("asic-cooling-controller-target-" + name, {
        whenChanged: [
            targetTemperatureTopicName
        ],
        then: function (newValue) {
            dryCoolingSetTemperatureCallback(newValue);
            wellCoolingSetTemperatureCallback(newValue);
            poolCoolingSetTemperatureCallback(newValue);
        }
    });

    defineRule("asic-pool-heat-active-" + name, {
        whenChanged: [
            poolHeatActiveTopicName
        ],
        then: function () {
            var heatActive = dev[poolHeatActiveTopicName];
            var currentMode = dev[modeTopicName];

            // Не трогаем режим, если выключено или пользователь вручную выбрал режим 2/3
            if (currentMode == 0 || currentMode == 2 || currentMode == 3) {
                return;
            }

            var newMode = currentMode;
            if (heatActive) {
                newMode = 4;
            } else {
                newMode = 1;
            }
            if (newMode != currentMode) {
                dev[modeTopicName] = newMode;
            }
        }
    });

    defineRule("asic-update-current-preset-" + name, {
        whenChanged: [
            firstASICPerformancePresetTopicName,
            secondASICPerformancePresetTopicName
        ],
        then: function () {
            var firstPreset = dev[firstASICPerformancePresetTopicName];
            var secondPreset = dev[secondASICPerformancePresetTopicName];
            if (firstPreset > secondPreset) {
                dev[currentPerformancePresetTopicName] = firstPreset;
            } else {
                dev[currentPerformancePresetTopicName] = secondPreset;
            }
        }
    });

    defineRule("asic-update-state-" + name, {
        whenChanged: [
            firstASICStateTopicName,
            secondASICStateTopicName
        ],
        then: function () {
            var firstState = dev[firstASICStateTopicName];
            var secondState = dev[secondASICStateTopicName];
            var currentMode = dev[modeTopicName];
            var heatActive = dev[poolHeatActiveTopicName];
            var newMode = currentMode;
            if (currentMode == 0) {
                if (isASICWork(firstState) || isASICWork(secondState)) {
                    if (heatActive) {
                        newMode = 4;
                    } else {
                        newMode = 1;
                    }
                }
            } else {
                if (isASICOffWork(firstState) && isASICOffWork(secondState)) {
                    newMode = 0;
                }
            }
            if (newMode != currentMode) {
                dev[modeTopicName] = newMode;
            }
        }
    });

    defineRule("asic-cooling-preset-switch-" + name, {
        whenChanged: [
            usePerformancePresetTopicName,
            currentPerformancePresetTopicName,
            performancePreset1TopicName,
            targetTemperature1TopicName,
            performancePreset2TopicName,
            targetTemperature2TopicName,
            performancePreset3TopicName,
            targetTemperature3TopicName,
            performancePreset4TopicName,
            targetTemperature4TopicName,
            performancePreset5TopicName,
            targetTemperature5TopicName,
            switchTemperature1TopicName,
            switchTemperature2TopicName,
            switchTemperature3TopicName,
            switchTemperature4TopicName,
            switchTemperature5TopicName
        ],
        then: function () {
            var usePerformancePreset = dev[usePerformancePresetTopicName];
            if (!usePerformancePreset) { return; }
            var currentPerformancePreset = dev[currentPerformancePresetTopicName];
            var performancePreset1 = dev[performancePreset1TopicName];
            var targetTemperature1 = dev[targetTemperature1TopicName];
            var switchTemperature1 = dev[switchTemperature1TopicName];
            var performancePreset2 = dev[performancePreset2TopicName];
            var targetTemperature2 = dev[targetTemperature2TopicName];
            var switchTemperature2 = dev[switchTemperature2TopicName];
            var performancePreset3 = dev[performancePreset3TopicName];
            var targetTemperature3 = dev[targetTemperature3TopicName];
            var switchTemperature3 = dev[switchTemperature3TopicName];
            var performancePreset4 = dev[performancePreset4TopicName];
            var targetTemperature4 = dev[targetTemperature4TopicName];
            var switchTemperature4 = dev[switchTemperature4TopicName];
            var performancePreset5 = dev[performancePreset5TopicName];
            var targetTemperature5 = dev[targetTemperature5TopicName];
            var switchTemperature5 = dev[switchTemperature5TopicName];
            var presets = [
                [performancePreset1, targetTemperature1, switchTemperature1],
                [performancePreset2, targetTemperature2, switchTemperature2],
                [performancePreset3, targetTemperature3, switchTemperature3],
                [performancePreset4, targetTemperature4, switchTemperature4],
                [performancePreset5, targetTemperature5, switchTemperature5]
            ];
            var preset = findTargetTemperature(currentPerformancePreset, presets);
            if (preset === null) {
                log("asic cooling preset switch: no valid presets configured, skipping");
                return;
            }
            dev[targetTemperatureTopicName] = preset[1];
            dev[switchTemperatureTopicName] = preset[2];
        }
    });
}

makeASICCoolingController(
    "T21",
    "wb-m1w2_107/External Sensor 1",
    function (newValue) {
        dev["pid-controller-dry-cooling/set_point"] = newValue;
    },
    function (newValue) {
        dev["pid-controller-esbe-actuator-asic/set_point"] = newValue;
    },
    function (newValue) {
        dev["pid-controller-esbe-actuator-asic/set_point"] = newValue;
    },
    function (enabled) {
        log("dry cooling set " + enabled);
        dev["pid-controller-dry-cooling/enabled"] = enabled;
        dev["pid-controller-dry-cooling-pump/enabled"] = enabled;
        if (enabled) {
            dev["pump-pwm-controller-dry-cooling-tower/state"] = 1;
        } else {
            dev["pump-pwm-controller-dry-cooling-tower/state"] = 2;
            dev["pid-controller-dry-cooling/power"] = 0;
        }
    },
    function (enabled) {
        log("well cooling set " + enabled);
        dev["start-stop-controller-well-cooling/enabled"] = enabled;
        dev["pid-controller-esbe-actuator-asic/enabled"] = enabled;
        if (enabled) {
            dev["pump-pwm-controller-well/state"] = 1;
        } else {
            dev["pump-pwm-controller-well/state"] = 2;
            dev["pid-controller-esbe-actuator-asic/power"] = 100;
        }
    },
    function (enabled) {
        log("pool cooling set " + enabled);
        dev["pid-controller-pool-heat-exchanger-pump/enabled"] = enabled;
        dev["pid-controller-esbe-actuator-asic/enabled"] = enabled;
        if (enabled) {
            dev["pump-pwm-controller-pool-heat-exchanger/state"] = 1;
        } else {
            dev["pump-pwm-controller-pool-heat-exchanger/state"] = 2;
            dev["pid-controller-esbe-actuator-asic/power"] = 100;
        }
    },
    "ANTMINER T21-1/current_preset",
    "ANTMINER T21-1/state",
    "ANTMINER T21-2/current_preset",
    "ANTMINER T21-2/state",
    "pool-heat-ctrl-outdoor/heat_request"
);
