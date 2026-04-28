function makePoolFiltrationController(
    name,
    pumpSwitchTopicName,
    buttonTopicName
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
                    0: { en: "Off", ru: "Выключено" },
                    1: { en: "Filtration", ru: "Фильтрация" },
                    2: { en: "Backwash", ru: "Обратная промывка" }
                }
            }
        }
    });

    var modeTopicName = deviceName + "/mode";

    defineRule("mode-changed-" + name, {
        whenChanged: [modeTopicName],
        then: function (newValue) {
            if (newValue == 0 || newValue == 2) {
                if (dev[pumpSwitchTopicName] !== false) {
                    dev[pumpSwitchTopicName] = false;
                }
            } else if (newValue == 1) {
                if (dev[pumpSwitchTopicName] !== true) {
                    dev[pumpSwitchTopicName] = true;
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
                if (mode == 0) {
                    dev[modeTopicName] = 1;
                }
            }
        }
    });

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

// modeTopicName вычисляется заранее, т.к. имя детерминировано
var modeTopicName = "pool-filtration-ctrl-outdoor/mode";

var meter = makePoolFiltrationMeter("outdoor", modeTopicName, 5000);

var sched = makePoolFiltrationSchedule(
    "outdoor",
    meter.poolVolumeTopicName,
    meter.pumpFlowRateTopicName,
    meter.filterDiameterTopicName,
    modeTopicName
);

makePoolFiltrationController(
    "outdoor",
    "wb-mr6cu_91/K1",
    "wb-mcm8_238/Input 3"
);
