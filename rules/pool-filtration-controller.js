function isValidTimeStr(timeStr) {
    if (typeof timeStr !== 'string') { return false; }
    var re = /^\d{2}:\d{2}$/;
    if (!re.test(timeStr)) { return false; }
    var parts = timeStr.split(':');
    var hours = parseInt(parts[0], 10);
    var minutes = parseInt(parts[1], 10);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function makePoolFiltrationController(
    name,
    pumpSwitchTopicName,
    scheduleTopicName,
    scheduleModeTopicName,
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

    defineRule("filtration-schedule-" + name, {
        when: cron("@every 1m"),
        then: function () {
            var scheduleMode = dev[scheduleModeTopicName];
            if (scheduleMode == 0) { return; }
            var mode = dev[modeTopicName];
            if (mode == 2) { return; }

            var timeWindowsStr = dev[scheduleTopicName];
            if (!timeWindowsStr || timeWindowsStr === "") { return; }
            var timeWindows = timeWindowsStr.split(',');

            var now = new Date();
            var currentMinutes = now.getHours() * 60 + now.getMinutes();

            var isInWindow = false;

            for (var i = 0; i < timeWindows.length; i++) {
                var timeWindow = timeWindows[i].split('-');
                if (!timeWindow[0] || !timeWindow[1]) { continue; }
                if (!isValidTimeStr(timeWindow[0]) || !isValidTimeStr(timeWindow[1])) {
                    log.warning("[pool-filtration-ctrl-{}] invalid time window: '{}'", name, timeWindows[i]);
                    continue;
                }
                var startParts = timeWindow[0].split(':');
                var endParts = timeWindow[1].split(':');

                var startTotal = parseInt(startParts[0], 10) * 60 + parseInt(startParts[1], 10);
                var endTotal = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1], 10);

                if (endTotal < startTotal) {
                    if (currentMinutes >= startTotal || currentMinutes < endTotal) {
                        isInWindow = true;
                        break;
                    }
                } else {
                    if (currentMinutes >= startTotal && currentMinutes < endTotal) {
                        isInWindow = true;
                        break;
                    }
                }
            }

            if (isInWindow) {
                if (mode != 1) { dev[modeTopicName] = 1; }
            } else {
                if (mode != 0) { dev[modeTopicName] = 0; }
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
    meter.filterDiameterTopicName
);

makePoolFiltrationController(
    "outdoor",
    "wb-mr6cu_91/K1",
    sched.scheduleTopicName,
    sched.scheduleModeTopicName,
    "wb-mcm8_238/Input 3"
);
