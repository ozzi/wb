// Оркестратор источника тепла для бассейна.
// Читает статус от pool-heat-controller, выбирает источник тепла (ASIC или электрокотёл)
// и делегирует управление соответствующему драйверу.

var POOL_STATUS_IDLE           = 2;
var POOL_STATUS_HEATING        = 3;
var POOL_STATUS_WAITING_SETTLE = 6;

function makePoolHeatSourceController(
    name,
    poolHeatRequestTopicName,
    asicDeviceNames,
    boilerRelayTopicName
) {
    var deviceName = "pool-heat-source-ctrl-" + name;
    var asicIntentTopicName = "asic-cooling-ctrl-" + name + "/intent";

    makeASICCoolingController(name, asicDeviceNames);

    defineVirtualDevice(deviceName, {
        title: "Pool Heat Source Controller - " + name,
        cells: {
            heat_source: {
                title: "heat source",
                type: "value",
                value: 0,
                readonly: false,
                enum: {
                    0: {en: "ASIC",   ru: "ASIC"},
                    1: {en: "Boiler", ru: "Электрокотёл"}
                }
            }
        }
    });

    var heatSourceTopicName = deviceName + "/heat_source";

    function stopBoiler() {
        if (boilerRelayTopicName) {
            log("[pool-heat-source-{}] stopping boiler", name);
            dev[boilerRelayTopicName] = false;
        }
    }

    function startBoiler() {
        if (boilerRelayTopicName) {
            log("[pool-heat-source-{}] starting boiler", name);
            dev[boilerRelayTopicName] = true;
        }
    }

    function applyHeatRequest() {
        var heatRequest = dev[poolHeatRequestTopicName];
        var heatSource  = dev[heatSourceTopicName];
        log("[pool-heat-source-{}] heat_request = {}, heat_source = {}", name, heatRequest, heatSource);

        if (heatSource === 1) {
            // Режим электрокотла: асики останавливаем принудительно
            dev[asicIntentTopicName] = "force_stop";
            if (heatRequest === POOL_STATUS_HEATING) {
                startBoiler();
            } else if (heatRequest === POOL_STATUS_WAITING_SETTLE) {
                log("[pool-heat-source-{}] boiler mode: waiting for temperature settle, doing nothing", name);
            } else {
                stopBoiler();
            }
            return;
        }

        // Режим ASIC (heatSource === 0)
        stopBoiler();

        if (heatRequest === POOL_STATUS_HEATING) {
            dev[asicIntentTopicName] = "heat";
        } else if (heatRequest === POOL_STATUS_WAITING_SETTLE) {
            log("[pool-heat-source-{}] ASIC mode: waiting for temperature settle, doing nothing", name);
        } else if (heatRequest === POOL_STATUS_IDLE) {
            dev[asicIntentTopicName] = "idle";
        } else {
            // STATUS_OFF, STATUS_STANDBY, STATUS_ERROR_* — немедленная остановка
            dev[asicIntentTopicName] = "force_stop";
        }
    }

    defineRule("pool-heat-source-" + name, {
        whenChanged: [poolHeatRequestTopicName, heatSourceTopicName],
        then: function () {
            applyHeatRequest();
        }
    });

    applyHeatRequest();
}

makePoolHeatSourceController(
    "outdoor",
    "pool-heat-ctrl-outdoor/status",
    ["ANTMINER S21e"],
    "wb-mr6cu_XX/K1"  // TODO: заменить на реальный топик реле электрокотла
);
