function makeCoagulantDosingController(
    name,
    relayTopicName,
    filtrationModeTopicName
) {
    var deviceName = "coagulant-dosing-ctrl-" + name;

    defineVirtualDevice(deviceName, {
        title: "Coagulant Dosing Controller - " + name,
        cells: {
            enabled: {
                title: "enabled",
                type: "switch",
                value: true,
                readonly: false
            },
            dose_duration: {
                title: "dose duration",
                type: "value",
                unit: "сек",
                value: 30,
                readonly: false
            },
            dose_interval: {
                title: "dose interval",
                type: "value",
                unit: "мин",
                value: 60,
                readonly: false
            },
            dosing_active: {
                title: "dosing active",
                type: "switch",
                value: false,
                readonly: true
            },
            status: {
                title: "status",
                type: "text",
                value: "idle",
                readonly: true
            },
            flow_rate: {
                title: "pump flow rate",
                type: "value",
                unit: "л/ч",
                value: 1.5,
                readonly: false
            },
            total_volume: {
                title: "total volume",
                type: "value",
                unit: "л",
                value: 0,
                readonly: true
            },
            reset_btn: {
                title: "reset total volume",
                type: "pushbutton",
                readonly: false
            }
        }
    });

    var enabledTopicName      = deviceName + "/enabled";
    var doseDurationTopicName = deviceName + "/dose_duration";
    var doseIntervalTopicName = deviceName + "/dose_interval";
    var dosingActiveTopicName = deviceName + "/dosing_active";
    var statusTopicName       = deviceName + "/status";
    var flowRateTopicName     = deviceName + "/flow_rate";
    var totalVolumeTopicName  = deviceName + "/total_volume";
    var resetBtnTopicName     = deviceName + "/reset_btn";

    var doseTimer    = null;
    var intervalTimer = null;

    function stopDose() {
        if (doseTimer !== null) {
            clearTimeout(doseTimer);
            doseTimer = null;
        }
        dev[relayTopicName]      = false;
        dev[dosingActiveTopicName] = false;
        dev[statusTopicName]     = "idle";
    }

    function startDose() {
        var filtrationMode = dev[filtrationModeTopicName];
        var enabled        = dev[enabledTopicName];

        if (filtrationMode !== 1 || enabled !== true) {
            return;
        }

        var duration = dev[doseDurationTopicName];
        if (!duration || duration <= 0) { duration = 30; }

        log.info("[coagulant-dosing-ctrl-{}] starting dose for {} sec", name, duration);

        dev[relayTopicName]        = true;
        dev[dosingActiveTopicName] = true;
        dev[statusTopicName]       = "dosing";

        doseTimer = setTimeout(function () {
            doseTimer = null;

            // Начисляем объём
            var flowRate = dev[flowRateTopicName];
            if (flowRate && flowRate > 0) {
                var durationHours = duration / 3600;
                dev[totalVolumeTopicName] += flowRate * durationHours;
            }

            stopDose();
            log.info("[coagulant-dosing-ctrl-{}] dose complete", name);
        }, duration * 1000);
    }

    function scheduleInterval() {
        if (intervalTimer !== null) {
            clearInterval(intervalTimer);
            intervalTimer = null;
        }

        var intervalMin = dev[doseIntervalTopicName];
        if (!intervalMin || intervalMin <= 0) { intervalMin = 60; }

        intervalTimer = setInterval(function () {
            startDose();
        }, intervalMin * 60 * 1000);
    }

    function applyState() {
        var filtrationMode = dev[filtrationModeTopicName];
        var enabled        = dev[enabledTopicName];

        if (filtrationMode !== 1 || enabled !== true) {
            stopDose();
            if (intervalTimer !== null) {
                clearInterval(intervalTimer);
                intervalTimer = null;
            }
            dev[statusTopicName] = "idle";
            return;
        }

        // Фильтрация активна — запускаем первую дозу сразу и планируем интервал
        scheduleInterval();
        startDose();
    }

    defineRule("coagulant-filtration-changed-" + name, {
        whenChanged: [filtrationModeTopicName],
        then: function () {
            applyState();
        }
    });

    defineRule("coagulant-enabled-changed-" + name, {
        whenChanged: [enabledTopicName],
        then: function () {
            applyState();
        }
    });

    defineRule("coagulant-interval-changed-" + name, {
        whenChanged: [doseIntervalTopicName],
        then: function () {
            var filtrationMode = dev[filtrationModeTopicName];
            var enabled        = dev[enabledTopicName];
            if (filtrationMode === 1 && enabled === true) {
                scheduleInterval();
            }
        }
    });

    defineRule("coagulant-reset-btn-" + name, {
        whenChanged: [resetBtnTopicName],
        then: function () {
            dev[totalVolumeTopicName] = 0;
            log.info("[coagulant-dosing-ctrl-{}] total volume reset", name);
        }
    });

    // Инициализация
    applyState();

    return {
        dosingActiveTopicName: dosingActiveTopicName
    };
}

// --- Точка входа ---

var coagulantDosing = makeCoagulantDosingController(
    "outdoor",
    "wb-mr6cu_91/K4",
    "pool-filtration-ctrl-outdoor/mode"
);
