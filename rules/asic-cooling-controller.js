var HEAT_REQUEST_IDLE    = 0;
var HEAT_REQUEST_HEATING = 1;
var HEAT_REQUEST_STOP    = 2;

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
        for (var i = 0; i < asicDeviceNames.length; i++) {
            dev[asicDeviceNames[i] + "/start_mining"] = true;
        }
        dev[miningStartedAtTopicName] = Date.now();
    }

    function applyHeatRequest() {
        var heatRequest = dev[poolHeatRequestTopicName];
        log("[asic-pool-heat-{}] heat_request = {}", name, heatRequest);

        if (heatRequest === HEAT_REQUEST_HEATING) {
            cancelStopTimer();
            startAllASICs();
        } else if (heatRequest === HEAT_REQUEST_STOP) {
            cancelStopTimer();
            stopAllASICs();
        } else if (heatRequest === HEAT_REQUEST_IDLE) {
            var miningStartedAt = dev[miningStartedAtTopicName];
            if (!miningStartedAt || miningStartedAt === 0) {
                // Асик никогда не запускался этим контроллером — ничего не делаем
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
    "pool-heat-ctrl-outdoor/heat_request",
    ["ANTMINER S21e"]
);
