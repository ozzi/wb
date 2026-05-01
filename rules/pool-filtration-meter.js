function makePoolFiltrationMeter(name, modeTopicName, timeframe) {
    var deviceName = "pool-filtration-meter-" + name;

    defineVirtualDevice(deviceName, {
        title: "Pool Filtration Meter - " + name,
        cells: {
            daily_cycles: {
                type: "value",
                readonly: true,
                value: 0
            },
            total_filtration_volume: {
                type: "value",
                unit: "л",
                readonly: true,
                value: 0
            },
            filtration_speed: {
                type: "value",
                unit: "м3/ч/м2",
                readonly: true,
                value: 0
            },
            filter_diameter: {
                type: "value",
                unit: "мм",
                readonly: false,
                value: 450
            },
            pool_volume: {
                type: "value",
                unit: "л",
                readonly: false,
                value: 28000
            },
            pump_flow_rate: {
                type: "value",
                unit: "м3/ч",
                readonly: false,
                value: 13
            }
        }
    });

    var dailyCyclesTopicName = deviceName + "/daily_cycles";
    var totalVolumeTopicName = deviceName + "/total_filtration_volume";
    var filtrationSpeedTopicName = deviceName + "/filtration_speed";
    var filterDiameterTopicName = deviceName + "/filter_diameter";
    var poolVolumeTopicName = deviceName + "/pool_volume";
    var pumpFlowRateTopicName = deviceName + "/pump_flow_rate";

    defineRule("filtration-speed-calc-" + name, {
        whenChanged: [
            modeTopicName,
            pumpFlowRateTopicName,
            filterDiameterTopicName
        ],
        then: function () {
            var dia = dev[filterDiameterTopicName] / 1000;
            if (dia <= 0) {
                log.warning("[pool-filtration-meter-{}] filter_diameter is zero or negative", name);
                return;
            }
            var isFiltration = dev[modeTopicName] == 1;
            var pumpFlow = dev[pumpFlowRateTopicName];
            var filterArea = Math.PI * Math.pow(dia / 2, 2);
            var speed = isFiltration ? pumpFlow / filterArea : 0;
            dev[filtrationSpeedTopicName] = speed;
        }
    });

    var last_update = 0;

    var dailyCyclesCalc = function () {
        var now = Date.now();
        var totalVolume = dev[totalVolumeTopicName];
        var isFiltration = dev[modeTopicName] == 1;
        if (last_update > 0 && isFiltration) {
            var hours = (now - last_update) / (1000 * 3600);
            var pumpFlow = dev[pumpFlowRateTopicName];
            if (!pumpFlow || pumpFlow <= 0) {
                log.warning("[pool-filtration-meter-{}] pumpFlow is zero or invalid, skipping volume accumulation", name);
            } else {
                totalVolume += pumpFlow * 1000 * hours;
            }
        }
        last_update = now;
        dev[totalVolumeTopicName] = totalVolume;
        var poolVolume = dev[poolVolumeTopicName];
        dev[dailyCyclesTopicName] = totalVolume / poolVolume;
    };

    setInterval(dailyCyclesCalc, timeframe);

    defineRule("reset-daily-stats-" + name, {
        when: cron("0 0 * * *"),
        then: function () {
            dev[totalVolumeTopicName] = 0;
            dev[dailyCyclesTopicName] = 0;
        }
    });

    return {
        poolVolumeTopicName: poolVolumeTopicName,
        pumpFlowRateTopicName: pumpFlowRateTopicName,
        filterDiameterTopicName: filterDiameterTopicName
    };
}

// --- Точка входа ---

var meter = makePoolFiltrationMeter(
    "outdoor",
    "pool-filtration-ctrl-outdoor/mode",
    5000
);
