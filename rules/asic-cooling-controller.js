// Version: 3
// Контроллер охлаждения ASIC майнеров.
// Управляет запуском и остановкой майнеров с учётом минимального времени работы.
// Используется как драйвер исполнительного устройства — не содержит логики выбора источника тепла.
//
// Управление через flash-кнопки:
//   heat       — запустить майнеры
//   idle       — остановить с учётом минимального времени работы
//   force_stop — немедленная остановка

function makeASICCoolingController(name, asicDeviceNames, pumpPowerTopicName) {
    var deviceName = "asic-cooling-ctrl-" + name;

    defineVirtualDevice(deviceName, {
        title: "ASIC Cooling Controller - " + name,
        cells: {
            heat: {
                title: "heat",
                type: "pushbutton"
            },
            idle: {
                title: "idle",
                type: "pushbutton"
            },
            force_stop: {
                title: "force stop",
                type: "pushbutton"
            },
            min_run_minutes: {
                title: "min run minutes",
                type: "value",
                value: 30,
                readonly: false
            },
            coast_down_seconds: {
                title: "coast down seconds",
                type: "value",
                value: 30,
                readonly: false
            },
            mining_started_at: {
                title: "mining started at (ms)",
                type: "value",
                value: 0,
                readonly: true
            }
        }
    });

    var heatTopicName       = deviceName + "/heat";
    var idleTopicName       = deviceName + "/idle";
    var forceStopTopicName  = deviceName + "/force_stop";
    var minRunMinutesTopicName   = deviceName + "/min_run_minutes";
    var coastDownSecondsTopicName = deviceName + "/coast_down_seconds";
    var miningStartedAtTopicName = deviceName + "/mining_started_at";

    var stopTimer = null;
    var pumpCoastDownTimer = null;

    function cancelStopTimer() {
        if (stopTimer !== null) {
            clearTimeout(stopTimer);
            stopTimer = null;
        }
    }

    function cancelPumpCoastDownTimer() {
        if (pumpCoastDownTimer !== null) {
            clearTimeout(pumpCoastDownTimer);
            pumpCoastDownTimer = null;
        }
    }

    function startPump() {
        if (pumpPowerTopicName) {
            log("[asic-cooling-{}] starting pump", name);
            dev[pumpPowerTopicName] = 1000;
        }
    }

    function stopPump() {
        if (pumpPowerTopicName) {
            log("[asic-cooling-{}] stopping pump", name);
            dev[pumpPowerTopicName] = 0;
        }
    }

    function schedulePumpStop() {
        if (!pumpPowerTopicName) { return; }
        cancelPumpCoastDownTimer();
        var seconds = dev[coastDownSecondsTopicName];
        if (!seconds || seconds <= 0) {
            stopPump();
            return;
        }
        log("[asic-cooling-{}] pump coast down: stopping in {} sec", name, seconds);
        pumpCoastDownTimer = setTimeout(function () {
            pumpCoastDownTimer = null;
            stopPump();
        }, seconds * 1000);
    }

    function stopAllASICs() {
        log("[asic-cooling-{}] stopping all ASICs", name);
        for (var i = 0; i < asicDeviceNames.length; i++) {
            dev[asicDeviceNames[i] + "/stop_mining"] = true;
        }
        dev[miningStartedAtTopicName] = 0;
    }

    function startAllASICs() {
        log("[asic-cooling-{}] starting all ASICs", name);
        for (var i = 0; i < asicDeviceNames.length; i++) {
            var asicDevice = asicDeviceNames[i];
            var state = dev[asicDevice + "/state"];
            if (state === "failure") {
                log("[asic-cooling-{}] skipping {} — device is in failure state", name, asicDevice);
                continue;
            }
            dev[asicDevice + "/start_mining"] = true;
        }
    }

    function onHeat() {
        log("[asic-cooling-{}] cmd: heat", name);
        cancelStopTimer();
        cancelPumpCoastDownTimer();
        startPump();
        if (!dev[miningStartedAtTopicName] || dev[miningStartedAtTopicName] === 0) {
            dev[miningStartedAtTopicName] = Date.now();
        }
        startAllASICs();
    }

    function onIdle() {
        log("[asic-cooling-{}] cmd: idle", name);
        var miningStartedAt = dev[miningStartedAtTopicName];
        if (!miningStartedAt || miningStartedAt === 0) {
            stopAllASICs();
            return;
        }
        var minRunMinutes = dev[minRunMinutesTopicName];
        var elapsed = (Date.now() - miningStartedAt) / 60000;
        var remaining = minRunMinutes - elapsed;
        if (remaining <= 0) {
            stopAllASICs();
            schedulePumpStop();
        } else {
            log("[asic-cooling-{}] waiting {} min before stop", name, Math.ceil(remaining));
            cancelStopTimer();
            stopTimer = setTimeout(function () {
                stopTimer = null;
                stopAllASICs();
                schedulePumpStop();
            }, remaining * 60 * 1000);
        }
    }

    function onForceStop() {
        log("[asic-cooling-{}] cmd: force_stop", name);
        cancelStopTimer();
        stopAllASICs();
        schedulePumpStop();
    }

    defineRule("asic-cooling-heat-" + name, {
        whenChanged: [heatTopicName],
        then: function () { onHeat(); }
    });

    defineRule("asic-cooling-idle-" + name, {
        whenChanged: [idleTopicName],
        then: function () { onIdle(); }
    });

    defineRule("asic-cooling-force-stop-" + name, {
        whenChanged: [forceStopTopicName],
        then: function () { onForceStop(); }
    });
}

makeASICCoolingController(
    "outdoor",
    ["ANTMINER S21e"],
    "pump-pwm-controller-asic/power"
);
