// Контроллер охлаждения ASIC майнеров.
// Управляет запуском и остановкой майнеров с учётом минимального времени работы.
// Используется как драйвер исполнительного устройства — не содержит логики выбора источника тепла.
//
// Intent-модель: оркестратор пишет в топик intent одно из значений:
//   "heat"       — запустить майнеры
//   "idle"       — остановить с учётом минимального времени работы
//   "force_stop" — немедленная остановка

function makeASICCoolingController(name, asicDeviceNames) {
    var deviceName = "asic-cooling-ctrl-" + name;

    defineVirtualDevice(deviceName, {
        title: "ASIC Cooling Controller - " + name,
        cells: {
            intent: {
                title: "intent",
                type: "text",
                value: "force_stop",
                readonly: false
            },
            min_run_minutes: {
                title: "min run minutes",
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

    var intentTopicName = deviceName + "/intent";
    var minRunMinutesTopicName = deviceName + "/min_run_minutes";
    var miningStartedAtTopicName = deviceName + "/mining_started_at";

    var stopTimer = null;

    function cancelStopTimer() {
        if (stopTimer !== null) {
            clearTimeout(stopTimer);
            stopTimer = null;
        }
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
        var anyStarted = false;
        for (var i = 0; i < asicDeviceNames.length; i++) {
            var asicDevice = asicDeviceNames[i];
            var state = dev[asicDevice + "/state"];
            if (state === "failure") {
                log("[asic-cooling-{}] skipping {} — device is in failure state", name, asicDevice);
                continue;
            }
            dev[asicDevice + "/start_mining"] = true;
            anyStarted = true;
        }
        if (anyStarted && (!dev[miningStartedAtTopicName] || dev[miningStartedAtTopicName] === 0)) {
            dev[miningStartedAtTopicName] = Date.now();
        }
    }

    function applyIntent() {
        var intent = dev[intentTopicName];
        log("[asic-cooling-{}] intent = {}", name, intent);

        if (intent === "heat") {
            cancelStopTimer();
            if (!dev[miningStartedAtTopicName] || dev[miningStartedAtTopicName] === 0) {
                dev[miningStartedAtTopicName] = Date.now();
            }
            startAllASICs();
        } else if (intent === "idle") {
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
            } else {
                log("[asic-cooling-{}] waiting {} min before stop", name, Math.ceil(remaining));
                cancelStopTimer();
                stopTimer = setTimeout(function () {
                    stopTimer = null;
                    stopAllASICs();
                }, remaining * 60 * 1000);
            }
        } else {
            // "force_stop" или любое неизвестное значение
            cancelStopTimer();
            stopAllASICs();
        }
    }

    defineRule("asic-cooling-intent-" + name, {
        whenChanged: [intentTopicName],
        then: function () {
            applyIntent();
        }
    });

    applyIntent();
}
