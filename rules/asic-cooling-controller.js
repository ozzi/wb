var POOL_STATUS_IDLE    = 2;
var POOL_STATUS_HEATING = 3;

function makeASICPoolHeatController(
    name,
    poolHeatRequestTopicName,
    asicDeviceNames
) {
    var deviceName = "asic-pool-heat-ctrl-" + name;

    defineVirtualDevice(deviceName, {
        title: "ASIC Pool Heat Controller - " + name,
        cells: {
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
        log("[asic-pool-heat-{}] stopping all ASICs", name);
        for (var i = 0; i < asicDeviceNames.length; i++) {
            dev[asicDeviceNames[i] + "/stop_mining"] = true;
        }
        dev[miningStartedAtTopicName] = 0;
    }

    function startAllASICs() {
        log("[asic-pool-heat-{}] starting all ASICs", name);
        var anyStarted = false;
        for (var i = 0; i < asicDeviceNames.length; i++) {
            var asicDevice = asicDeviceNames[i];
            var state = dev[asicDevice + "/state"];
            if (state === "failure") {
                log("[asic-pool-heat-{}] skipping {} — device is in failure state", name, asicDevice);
                continue;
            }
            dev[asicDevice + "/start_mining"] = true;
            anyStarted = true;
        }
        if (anyStarted && (!dev[miningStartedAtTopicName] || dev[miningStartedAtTopicName] === 0)) {
            dev[miningStartedAtTopicName] = Date.now();
        }
    }

    function applyHeatRequest() {
        var heatRequest = dev[poolHeatRequestTopicName];
        log("[asic-pool-heat-{}] heat_request = {}", name, heatRequest);

        if (heatRequest === POOL_STATUS_HEATING) {
            cancelStopTimer();
            // Если miningStartedAt не установлен — фиксируем текущее время
            // (асик мог быть запущен до старта wb-rules)
            if (!dev[miningStartedAtTopicName] || dev[miningStartedAtTopicName] === 0) {
                dev[miningStartedAtTopicName] = Date.now();
            }
            startAllASICs();
        } else if (heatRequest === POOL_STATUS_IDLE) {
            var miningStartedAt = dev[miningStartedAtTopicName];
            if (!miningStartedAt || miningStartedAt === 0) {
                // Асик никогда не запускался этим контроллером — останавливаем на всякий случай
                stopAllASICs();
                return;
            }
            var minRunMinutes = dev[minRunMinutesTopicName];
            var elapsed = (Date.now() - miningStartedAt) / 60000;
            var remaining = minRunMinutes - elapsed;
            if (remaining <= 0) {
                stopAllASICs();
            } else {
                log("[asic-pool-heat-{}] idle: waiting {} min before stop", name, Math.ceil(remaining));
                cancelStopTimer();
                stopTimer = setTimeout(function () {
                    stopTimer = null;
                    stopAllASICs();
                }, remaining * 60 * 1000);
            }
        } else {
            // STATUS_OFF, STATUS_STANDBY, STATUS_ERROR_* — немедленная остановка
            cancelStopTimer();
            stopAllASICs();
        }
    }

    defineRule("asic-pool-heat-" + name, {
        whenChanged: [poolHeatRequestTopicName],
        then: function () {
            applyHeatRequest();
        }
    });

    applyHeatRequest();
}

makeASICPoolHeatController(
    "outdoor",
    "pool-heat-ctrl-outdoor/status",
    ["ANTMINER S21e"]
);
